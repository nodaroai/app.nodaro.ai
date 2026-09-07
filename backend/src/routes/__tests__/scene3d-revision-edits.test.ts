import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { scene3DRevisionEditRoutes } from "../scene3d-revision-edits.js"
const edit = vi.hoisted(() => vi.fn())
vi.mock("../../services/scene3d/scene3d-retained-edit.js", () => ({
  editRetainedScene3D: edit,
  Scene3DRetainedEditError: class extends Error {},
}))
vi.mock("../../middleware/rate-limit.js", () => ({ rateLimiter: () => async () => {} }))
const revision = "00000000-0000-4000-8000-000000000003"
const payload = {
 newRevisionId:"00000000-0000-4000-8000-000000000004",expectedContentHash:"1".repeat(64),
 operations:[{op:"set-override",override:{kind:"entity-visibility",entityId:"box",visible:false}}],
}
async function request(options: { authenticated?:boolean; scopes?:string[]; body?:unknown }) {
 edit.mockReset().mockResolvedValue({scenePlan:{revisionId:payload.newRevisionId},changeSummary:"Changed visibility"})
 const app=Fastify()
 app.addHook("preHandler",async req=>{
  if(options.authenticated!==false) req.userId="actor"
  if(options.scopes) req.appAuthorization={appId:"a",authorizationId:"z",scopes:options.scopes} as typeof req.appAuthorization
 })
 await app.register(scene3DRevisionEditRoutes)
 try {return await app.inject({method:"POST",url:`/v1/3d-scene/revisions/${revision}/edits`,payload:options.body??payload})}
 finally {await app.close()}
}
describe("scene revision edit route",()=>{
 it("rejects an unauthenticated edit",async()=>{
  expect((await request({authenticated:false})).statusCode).toBe(401)
  expect(edit).not.toHaveBeenCalled()
 })
 it("rejects OAuth read-only tokens before persistence",async()=>{
  expect((await request({scopes:["workflows:read"]})).statusCode).toBe(403)
  expect(edit).not.toHaveBeenCalled()
 })
 it("uses the authenticated actor and exact parent revision",async()=>{
  const response=await request({scopes:["workflows:write"]})
  expect(response.statusCode).toBe(200)
  expect(edit).toHaveBeenCalledWith("actor",{...payload,revisionId:revision},null)
  expect(response.json().scenePlan.revisionId).toBe(payload.newRevisionId)
 })
 it("refuses unknown fields rather than accepting arbitrary plan or artifact writes",async()=>{
  expect((await request({body:{...payload,scenePlan:{schemaVersion:2}}})).statusCode).toBe(400)
  expect(edit).not.toHaveBeenCalled()
 })
})
