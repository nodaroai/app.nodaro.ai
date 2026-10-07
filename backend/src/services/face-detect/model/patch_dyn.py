#!/usr/bin/env python3
"""patch_dyn.py <in.onnx> <out.onnx>: make YuNet's fixed 1x3x640x640 input (and outputs) symbolic so
onnxruntime accepts the padded native frame size, as OpenCV's DNN does."""
import sys, onnx
m = onnx.load(sys.argv[1])
d = m.graph.input[0].type.tensor_type.shape.dim
d[2].dim_param, d[3].dim_param = "H", "W"
for o in m.graph.output:
    o.type.tensor_type.shape.dim[1].dim_param = "N"
del m.graph.value_info[:]
onnx.save(m, sys.argv[2])
