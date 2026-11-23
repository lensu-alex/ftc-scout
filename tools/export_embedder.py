"""Dev: export a small appearance-embedding model (MobileNetV3-small, ImageNet weights) to ONNX.
Input 1x3x128x128 (RGB 0..1), output a 576-d feature (global-pooled), L2-normalised in the app."""
import torch, torchvision
m = torchvision.models.mobilenet_v3_small(weights="IMAGENET1K_V1").eval()
class Embed(torch.nn.Module):
    def __init__(s, m): super().__init__(); s.f = m.features; s.pool = torch.nn.AdaptiveAvgPool2d(1)
    def forward(s, x):
        mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1); std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
        return s.pool(s.f((x - mean) / std)).flatten(1)
torch.onnx.export(Embed(m), torch.zeros(1, 3, 128, 128), "../app/public/models/ftc-embed.onnx", input_names=["x"], output_names=["e"], opset_version=17, dynamo=False)
import os; print("MB", os.path.getsize("../app/public/models/ftc-embed.onnx") / 1e6)
