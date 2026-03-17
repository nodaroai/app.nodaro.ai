import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { generateImage, getJobStatus } from "@/lib/api";
import { resolveTemplate, applyTemplate } from "@/lib/prompt-templates";
import type {
  WorkflowNode,
  WorkflowEdge,
  GenerateScriptData,
  GeneratedScript,
  SceneImageVersion,
  SceneNodeDataType,
} from "@/types/nodes";
import {
  getSceneCharacterNames,
  mapScriptSceneToNodeData,
  NODE_DEFINITIONS,
} from "@/types/nodes";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  type ExecutionContext,
} from "./types";

// ---------------------------------------------------------------------------
// Scene-in-script helpers
// ---------------------------------------------------------------------------

function updateSceneInScript(
  scriptNodeId: string,
  sceneIndex: number,
  patch: Partial<{
    imageStatus: "idle" | "running" | "completed" | "failed";
    generatedImages: readonly SceneImageVersion[];
    activeImageIndex: number;
  }>,
): void {
  const { nodes, updateNodeData } = useWorkflowStore.getState();
  const node = nodes.find((n) => n.id === scriptNodeId);
  if (!node) return;
  const data = node.data as GenerateScriptData;
  const script = data.generatedScript;
  if (!script) return;

  const updatedScenes = script.scenes.map((s, i) =>
    i === sceneIndex ? { ...s, ...patch } : s,
  );
  const updatedScript: GeneratedScript = { ...script, scenes: updatedScenes };
  const results = data.generatedResults ?? [];
  const activeIdx = data.activeResultIndex ?? 0;
  const updatedResults = results.map((r, i) =>
    i === activeIdx ? { ...r, script: updatedScript } : r,
  );
  updateNodeData(scriptNodeId, {
    generatedScript: updatedScript,
    generatedResults: updatedResults,
  });
}

// ---------------------------------------------------------------------------
// handleGenerateSceneImage
// ---------------------------------------------------------------------------

export async function handleGenerateSceneImage(
  scriptNodeId: string,
  sceneIndex: number,
  ctx: ExecutionContext,
): Promise<void> {
  const { nodes } = useWorkflowStore.getState();
  const node = nodes.find((n) => n.id === scriptNodeId);
  if (!node) return;

  const scriptData = node.data as GenerateScriptData;
  const script = scriptData.generatedScript;
  if (!script || !script.scenes[sceneIndex]) return;

  const scene = script.scenes[sceneIndex];

  // Block generation if description-only characters need references from earlier scenes
  const allCharDefs0 = useWorkflowStore.getState().characterDefinitions;
  const sceneCharNames0 = getSceneCharacterNames(scene.characters);
  for (const charName of sceneCharNames0) {
    const charDef = allCharDefs0.find((c) => c.name === charName);
    if (
      charDef &&
      charDef.type === "description" &&
      !charDef.referenceImageUrl
    ) {
      const earliestScene = script.scenes.findIndex(
        (s, idx) =>
          idx !== sceneIndex &&
          getSceneCharacterNames(s.characters).includes(charName),
      );
      if (earliestScene !== -1 && earliestScene < sceneIndex) {
        toast.error(`Generate Scene ${earliestScene + 1} first`, {
          description: `Save a reference for "${charName}" before generating this scene`,
        });
        return;
      }
    }
  }

  // Collect extracted reference images for this scene
  const extractedRefs = script.extractedReferences ?? [];
  const sceneChars = new Set(getSceneCharacterNames(scene.characters));
  const refUrls = extractedRefs
    .filter(
      (r) => r.sourceSceneIndex !== sceneIndex && sceneChars.has(r.name),
    )
    .map((r) => r.imageUrl);

  // Collect workflow-level character definitions matching scene characters
  const allCharDefs = useWorkflowStore.getState().characterDefinitions;
  const sceneCharDefs = allCharDefs.filter((c) => sceneChars.has(c.name));
  const charRefUrls = sceneCharDefs
    .filter((c) => c.type === "reference" && c.referenceImageUrl)
    .map((c) => c.referenceImageUrl as string);
  const userTemplates = useWorkflowStore.getState().userPromptTemplates;
  const flowTemplates = useWorkflowStore.getState().flowPromptTemplates;
  const charDescs = sceneCharDefs
    .filter((c) => c.type === "description" && c.description)
    .map((c) => {
      let templateKey: string;
      if (c.category === "face") {
        templateKey = "face-description";
      } else if (c.category === "location") {
        templateKey = "location-description";
      } else if (c.category === "object") {
        templateKey = "object-description";
      } else {
        templateKey = "character-description";
      }
      const template = resolveTemplate(
        templateKey,
        userTemplates,
        flowTemplates,
      );
      return applyTemplate(template, {
        name: c.name,
        description: c.description || "",
      });
    });

  const allRefImages = [...refUrls, ...charRefUrls];
  let finalPrompt: string;
  if (charDescs.length > 0) {
    const wrapperTemplate = resolveTemplate(
      "generate-image-wrapper",
      userTemplates,
      flowTemplates,
    );
    finalPrompt = applyTemplate(wrapperTemplate, {
      userPrompt: scene.imagePrompt,
      assetDescriptions: charDescs.join(" "),
    });
  } else {
    finalPrompt = scene.imagePrompt;
  }
  // Truncate to backend limit (2000 chars) after wrapper expansion
  if (finalPrompt.length > 2000) {
    finalPrompt = finalPrompt.slice(0, 1997) + "...";
  }

  updateSceneInScript(scriptNodeId, sceneIndex, { imageStatus: "running" });

  try {
    const { jobId } = await generateImage(
      finalPrompt,
      allRefImages.length > 0 ? allRefImages : undefined,
      undefined,
      undefined,
      undefined,
      ctx.userId,
    );

    await new Promise<void>((resolve, reject) => {
      let pollFailures = 0;
      const poll = ctx.trackInterval(
        setInterval(async () => {
          if (ctx.isWorkflowStale()) {
            ctx.untrackInterval(poll);
            reject(new WorkflowStaleError());
            return;
          }
          try {
            const job = await getJobStatus(jobId);
            pollFailures = 0;
            if (job.status === "completed") {
              ctx.untrackInterval(poll);
              const imageUrl =
                (job.output_data?.imageUrl as string | undefined) ?? "";

              const latestNode = useWorkflowStore
                .getState()
                .nodes.find((n) => n.id === scriptNodeId);
              const latestScene = (
                latestNode?.data as GenerateScriptData | undefined
              )?.generatedScript?.scenes[sceneIndex];
              const existing = latestScene?.generatedImages ?? [];
              const newVersion: SceneImageVersion = {
                url: imageUrl,
                timestamp: new Date().toISOString(),
                jobId,
              };
              const newImages = [newVersion, ...existing].slice(0, 5);

              updateSceneInScript(scriptNodeId, sceneIndex, {
                imageStatus: "completed",
                generatedImages: newImages,
                activeImageIndex: 0,
              });

              resolve();
            } else if (job.status === "failed") {
              ctx.untrackInterval(poll);
              updateSceneInScript(scriptNodeId, sceneIndex, {
                imageStatus: "failed",
              });
              reject(
                new Error(job.error_message ?? "Image generation failed"),
              );
            }
          } catch (err) {
            pollFailures++;
            if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
              ctx.untrackInterval(poll);
              reject(err);
            }
          }
        }, 2000),
      );
    });
  } catch (err) {
    if (err instanceof WorkflowStaleError) return;
    const latestNode = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === scriptNodeId);
    const latestScene = (latestNode?.data as GenerateScriptData | undefined)
      ?.generatedScript?.scenes[sceneIndex];
    if (latestScene?.imageStatus === "running") {
      updateSceneInScript(scriptNodeId, sceneIndex, {
        imageStatus: "failed",
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// handleExpandToSceneNodes
// ---------------------------------------------------------------------------

export function handleExpandToSceneNodes(
  scriptNodeId: string,
  options: { layout: "horizontal" | "vertical"; autoRun: boolean },
): void {
  const store = useWorkflowStore.getState();
  const scriptNode = store.nodes.find((n) => n.id === scriptNodeId);
  if (!scriptNode) return;

  const scriptData = scriptNode.data as GenerateScriptData;
  const activeIdx = scriptData.activeResultIndex ?? 0;
  const results = scriptData.generatedResults ?? [];
  const script = results[activeIdx]?.script ?? scriptData.generatedScript;
  if (!script) return;

  const scenes = script.scenes;
  const startX = scriptNode.position.x + 400;
  const startY = scriptNode.position.y;
  const isHorizontal = options.layout === "horizontal";

  const newNodes: WorkflowNode[] = [];
  const newEdges: WorkflowEdge[] = [];

  let idCounter =
    store.nodes.reduce((max, n) => {
      const num = parseInt(n.id.replace("node_", ""), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0) + 1;

  const sceneDefaults = NODE_DEFINITIONS.find((d) => d.type === "scene")
    ?.defaultData as SceneNodeDataType | undefined;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const mapped = mapScriptSceneToNodeData(scene);
    const images = scene.generatedImages ?? [];

    const nodeId = `node_${idCounter}`;
    idCounter += 1;

    const posX = isHorizontal ? startX + i * 350 : startX;
    const posY = isHorizontal ? startY : startY + i * 300;

    const nodeData: SceneNodeDataType = {
      ...(sceneDefaults ?? ({} as SceneNodeDataType)),
      ...mapped,
      label: `Scene ${scene.sceneNumber}`,
      sceneNumber: scene.sceneNumber,
      sourceScriptNodeId: scriptNodeId,
      sourceSceneIndex: i,
      autoSyncWithScript: true,
      fieldMappings: {},
    };

    if (images.length > 0) {
      nodeData.executionStatus = "completed";
      nodeData.generatedImageUrl =
        images[scene.activeImageIndex ?? 0]?.url ?? "";
      nodeData.generatedResults = images.map((img) => ({
        url: img.url,
        timestamp: img.timestamp,
        jobId: img.jobId,
      }));
      nodeData.activeResultIndex = scene.activeImageIndex ?? 0;
    }

    newNodes.push({
      id: nodeId,
      type: "scene",
      position: { x: posX, y: posY },
      data: nodeData,
    } as WorkflowNode);

    newEdges.push({
      id: `edge_${Date.now()}_script_scene_${i}`,
      source: scriptNodeId,
      sourceHandle: "scenes",
      target: nodeId,
      targetHandle: "in",
    } as WorkflowEdge);
  }

  store.batchAddNodesAndEdges(newNodes, newEdges);
  toast.success(`Created ${scenes.length} Scene Nodes`);

  if (options.autoRun) {
    for (let i = 0; i < scenes.length; i++) {
      const hasImage = (scenes[i].generatedImages ?? []).length > 0;
      if (!hasImage) {
        store.runSingleNode?.(newNodes[i].id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// handleExpandStoryboard
// ---------------------------------------------------------------------------

export function handleExpandStoryboard(
  scriptNodeId: string,
  options: {
    layout: "horizontal" | "vertical";
    autoRun: boolean;
    includeCombine: boolean;
    narrationSource?: "visualDescription" | "action" | "imagePrompt";
    nodeType?: "pipeline" | "scene";
  },
): void {
  if (options.nodeType === "scene") {
    handleExpandToSceneNodes(scriptNodeId, options);
    return;
  }
  const store = useWorkflowStore.getState();
  const scriptNode = store.nodes.find((n) => n.id === scriptNodeId);
  if (!scriptNode) return;

  const scriptData = scriptNode.data as GenerateScriptData;
  const activeIdx = scriptData.activeResultIndex ?? 0;
  const results = scriptData.generatedResults ?? [];
  const script = results[activeIdx]?.script ?? scriptData.generatedScript;
  if (!script) return;

  const scenes = script.scenes;
  const startX = scriptNode.position.x + 400;
  const startY = scriptNode.position.y;
  const narrationSource = options.narrationSource ?? "visualDescription";

  const newNodes: WorkflowNode[] = [];
  const newEdges: WorkflowEdge[] = [];

  let idCounter =
    store.nodes.reduce((max, n) => {
      const num = parseInt(n.id.replace("node_", ""), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0) + 1;

  function nextId(): string {
    const id = `node_${idCounter}`;
    idCounter += 1;
    return id;
  }

  const isHorizontal = options.layout === "horizontal";

  const imageNodeIds: string[] = [];
  const mergeNodeIds: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const images = scene.generatedImages ?? [];
    const hasImage = images.length > 0;
    const narrationText = scene[narrationSource] ?? scene.visualDescription;

    let textX: number, textY: number;
    let imgX: number, imgY: number;
    let vidX: number, vidY: number;
    let ttsX: number, ttsY: number;
    let mergeX: number, mergeY: number;

    if (isHorizontal) {
      const colX = startX + i * 350;
      textX = colX - 60;
      textY = startY + 300;
      imgX = colX;
      imgY = startY;
      vidX = colX - 60;
      vidY = startY + 150;
      ttsX = colX + 60;
      ttsY = startY + 300;
      mergeX = colX;
      mergeY = startY + 450;
    } else {
      const SCENE_HEIGHT = 450;
      const baseY = startY + i * SCENE_HEIGHT;

      imgX = startX;
      imgY = baseY;
      vidX = startX + 300;
      vidY = baseY;

      textX = startX;
      textY = baseY + 200;
      ttsX = startX + 300;
      ttsY = baseY + 200;
      mergeX = startX + 600;
      mergeY = baseY + 100;
    }

    // 1. Text Prompt (narration for TTS)
    const textNodeId = nextId();
    newNodes.push({
      id: textNodeId,
      type: "text-prompt",
      position: { x: textX, y: textY },
      data: {
        label: `Scene ${scene.sceneNumber} Narration`,
        text: narrationText,
        variables: {},
      },
    } as WorkflowNode);

    // 2. Generate Image
    const imageNodeId = nextId();
    imageNodeIds.push(imageNodeId);
    newNodes.push({
      id: imageNodeId,
      type: "generate-image",
      position: { x: imgX, y: imgY },
      data: {
        label: `Scene ${scene.sceneNumber} Image`,
        prompt: scene.imagePrompt,
        provider: "nano-banana",
        model: "gemini-2.5-flash-image",
        style: "",
        aspectRatio: "16:9",
        negativePrompt: "",
        fieldMappings: {},
        ...(hasImage
          ? {
              executionStatus: "completed",
              generatedImageUrl: images[scene.activeImageIndex ?? 0]?.url,
              generatedResults: images.map((img) => ({
                url: img.url,
                timestamp: img.timestamp,
                jobId: img.jobId,
              })),
              activeResultIndex: scene.activeImageIndex ?? 0,
            }
          : {}),
      },
    } as WorkflowNode);

    // 3. Image to Video
    const videoNodeId = nextId();
    newNodes.push({
      id: videoNodeId,
      type: "image-to-video",
      position: { x: vidX, y: vidY },
      data: {
        label: `Scene ${scene.sceneNumber} Video`,
        provider: "veo3",
        model: "veo3",
        duration: scene.durationHint,
        motion: "moderate",
        cameraMotion: "static",
        fieldMappings: {},
      },
    } as WorkflowNode);

    // 4. Text to Speech
    const ttsNodeId = nextId();
    newNodes.push({
      id: ttsNodeId,
      type: "text-to-speech",
      position: { x: ttsX, y: ttsY },
      data: {
        label: `Scene ${scene.sceneNumber} Voice`,
        provider: "elevenlabs-turbo",
        voiceId: "Rachel",
        language: "en",
        speed: 1,
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        languageCode: "",
        fieldMappings: {},
      },
    } as WorkflowNode);

    // 5. Merge Video & Audio
    const mergeNodeId = nextId();
    mergeNodeIds.push(mergeNodeId);
    newNodes.push({
      id: mergeNodeId,
      type: "merge-video-audio",
      position: { x: mergeX, y: mergeY },
      data: {
        label: `Scene ${scene.sceneNumber} Merge`,
        audioType: "voiceover",
        voiceoverVolume: 100,
        backgroundVolume: 30,
        fieldMappings: {},
      },
    } as WorkflowNode);

    // Edges
    newEdges.push({
      id: `edge_${Date.now()}_${i}_txt_tts`,
      source: textNodeId,
      sourceHandle: "prompt",
      target: ttsNodeId,
      targetHandle: "in",
    } as WorkflowEdge);

    newEdges.push({
      id: `edge_${Date.now()}_${i}_img_vid`,
      source: imageNodeId,
      sourceHandle: "image",
      target: videoNodeId,
      targetHandle: "startFrame",
    } as WorkflowEdge);

    newEdges.push({
      id: `edge_${Date.now()}_${i}_vid_merge`,
      source: videoNodeId,
      sourceHandle: "video",
      target: mergeNodeId,
      targetHandle: "in",
    } as WorkflowEdge);

    newEdges.push({
      id: `edge_${Date.now()}_${i}_tts_merge`,
      source: ttsNodeId,
      sourceHandle: "audio",
      target: mergeNodeId,
      targetHandle: "in",
    } as WorkflowEdge);
  }

  // Reference chain: connect Generate Image nodes for same characters
  const charSceneMap: Record<string, number[]> = {};
  for (let i = 0; i < scenes.length; i++) {
    for (const char of getSceneCharacterNames(scenes[i].characters)) {
      const arr = charSceneMap[char] ?? [];
      arr.push(i);
      charSceneMap[char] = arr;
    }
  }
  const connectedPairs = new Set<string>();
  for (const indices of Object.values(charSceneMap)) {
    for (let j = 1; j < indices.length; j++) {
      const pairKey = `${indices[j - 1]}_${indices[j]}`;
      if (!connectedPairs.has(pairKey)) {
        connectedPairs.add(pairKey);
        newEdges.push({
          id: `edge_${Date.now()}_ref_${indices[j - 1]}_${indices[j]}`,
          source: imageNodeIds[indices[j - 1]],
          sourceHandle: "image",
          target: imageNodeIds[indices[j]],
          targetHandle: "in",
        } as WorkflowEdge);
      }
    }
  }

  // Inject extracted reference images into Generate Image nodes
  const extractedRefs = script.extractedReferences ?? [];
  if (extractedRefs.length > 0) {
    for (let i = 0; i < scenes.length; i++) {
      const sceneChars = new Set(
        getSceneCharacterNames(scenes[i].characters),
      );
      const matchingRefs = extractedRefs.filter(
        (r) => r.sourceSceneIndex !== i && sceneChars.has(r.name),
      );
      if (matchingRefs.length > 0) {
        const imgNode = newNodes.find((n) => n.id === imageNodeIds[i]);
        if (imgNode) {
          const existingUrls: string[] =
            ((imgNode.data as Record<string, unknown>)
              .extractedReferenceUrls as string[]) ?? [];
          (imgNode.data as Record<string, unknown>).extractedReferenceUrls = [
            ...existingUrls,
            ...matchingRefs.map((r) => r.imageUrl),
          ];
        }
      }
    }
  }

  // Combine Videos: connect from Merge nodes
  if (options.includeCombine && scenes.length > 1) {
    const combineNodeId = nextId();
    const combineX = isHorizontal
      ? startX + scenes.length * 350 + 100
      : startX + 900;
    const combineY = isHorizontal
      ? startY + 450
      : startY + ((scenes.length - 1) * 450) / 2;

    newNodes.push({
      id: combineNodeId,
      type: "combine-videos",
      position: { x: combineX, y: combineY },
      data: {
        label: "Combine All Videos",
        transition: "cut",
        transitionDuration: 0.5,
        audioMode: "crossfade",
        fieldMappings: {},
      },
    } as WorkflowNode);

    for (let i = 0; i < mergeNodeIds.length; i++) {
      newEdges.push({
        id: `edge_${Date.now()}_${i}_merge_comb`,
        source: mergeNodeIds[i],
        sourceHandle: "video",
        target: combineNodeId,
        targetHandle: "in",
      } as WorkflowEdge);
    }
  }

  store.batchAddNodesAndEdges(newNodes, newEdges);

  const totalNodes =
    scenes.length * 5 + (options.includeCombine && scenes.length > 1 ? 1 : 0);
  toast.success(`Created ${totalNodes} nodes for ${scenes.length} scenes`);

  if (options.autoRun) {
    for (let i = 0; i < scenes.length; i++) {
      const hasImage = (scenes[i].generatedImages ?? []).length > 0;
      if (!hasImage) {
        const imageNode = newNodes[i * 5 + 1];
        if (imageNode) {
          store.runSingleNode?.(imageNode.id);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// handleCreateSceneNode
// ---------------------------------------------------------------------------

export function handleCreateSceneNode(
  scriptNodeId: string,
  sceneIndex: number,
): void {
  const store = useWorkflowStore.getState();
  const scriptNode = store.nodes.find((n) => n.id === scriptNodeId);
  if (!scriptNode) return;

  const scriptData = scriptNode.data as GenerateScriptData;
  const activeIdx = scriptData.activeResultIndex ?? 0;
  const results = scriptData.generatedResults ?? [];
  const script = results[activeIdx]?.script ?? scriptData.generatedScript;
  if (!script || !script.scenes[sceneIndex]) return;

  const scene = script.scenes[sceneIndex];
  const sceneDefaults = NODE_DEFINITIONS.find((d) => d.type === "scene")
    ?.defaultData as SceneNodeDataType | undefined;
  const mapped = mapScriptSceneToNodeData(scene);

  const nodeData: SceneNodeDataType = {
    ...(sceneDefaults ?? ({} as SceneNodeDataType)),
    ...mapped,
    label: `Scene ${scene.sceneNumber}`,
    sceneNumber: scene.sceneNumber,
    sourceScriptNodeId: scriptNodeId,
    sourceSceneIndex: sceneIndex,
    autoSyncWithScript: true,
    fieldMappings: {},
  };

  const images = scene.generatedImages ?? [];
  if (images.length > 0) {
    nodeData.executionStatus = "completed";
    nodeData.generatedImageUrl =
      images[scene.activeImageIndex ?? 0]?.url ?? "";
    nodeData.generatedResults = images.map((img) => ({
      url: img.url,
      timestamp: img.timestamp,
      jobId: img.jobId,
    }));
    nodeData.activeResultIndex = scene.activeImageIndex ?? 0;
  }

  const posX = scriptNode.position.x + 400;
  const posY = scriptNode.position.y + sceneIndex * 300;

  let idCounter =
    store.nodes.reduce((max, n) => {
      const num = parseInt(n.id.replace("node_", ""), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0) + 1;
  const newNodeId = `node_${idCounter}`;

  const newNode: WorkflowNode = {
    id: newNodeId,
    type: "scene",
    position: { x: posX, y: posY },
    data: nodeData,
  } as WorkflowNode;

  const newEdge: WorkflowEdge = {
    id: `edge_${Date.now()}_script_scene_${sceneIndex}`,
    source: scriptNodeId,
    sourceHandle: "scenes",
    target: newNodeId,
    targetHandle: "in",
  } as WorkflowEdge;

  store.batchAddNodesAndEdges([newNode], [newEdge]);
  store.selectNode(newNodeId);
  store.setAutoOpenEditorNodeId(newNodeId);
  toast.success(`Created Scene Node for Scene ${scene.sceneNumber}`);
}
