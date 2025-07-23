import os
import cv2
import numpy as np
from PIL import Image

def straighten_and_crop(image_path, save_path, alpha_threshold=1):
    # Load image with alpha
    pil_image = Image.open(image_path).convert("RGBA")
    np_image = np.array(pil_image)

    # Extract alpha and create visible content mask
    alpha = np_image[..., 3]
    mask = alpha > alpha_threshold

    if not np.any(mask):
        print(f"Skipping {image_path}: fully transparent")
        return

    # Use alpha mask for rotation detection only
    visible_mask = mask.astype(np.uint8) * 255
    coords = cv2.findNonZero(visible_mask)
    rect = cv2.minAreaRect(coords)
    angle = rect[-1]

    if angle < -45:
        angle += 90

    # Rotate around center, but increase canvas size to avoid cropping
    (h, w) = np_image.shape[:2]
    center = (w // 2, h // 2)

    # Compute new bounding dimensions
    abs_cos = abs(np.cos(np.radians(angle)))
    abs_sin = abs(np.sin(np.radians(angle)))
    new_w = int(h * abs_sin + w * abs_cos)
    new_h = int(h * abs_cos + w * abs_sin)

    # Adjust rotation matrix to fit entire rotated image
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    M[0, 2] += (new_w - w) / 2
    M[1, 2] += (new_h - h) / 2

    # Perform rotation with expanded canvas
    rotated = cv2.warpAffine(np_image, M, (new_w, new_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

    # Crop to non-transparent content in rotated image
    alpha_rotated = rotated[..., 3]
    visible = alpha_rotated > alpha_threshold

    coords = cv2.findNonZero(visible.astype(np.uint8))
    x, y, w, h = cv2.boundingRect(coords)
    cropped = rotated[y:y+h, x:x+w]

    # Save result
    result_image = Image.fromarray(cropped, "RGBA")
    result_image.save(save_path)
    print(f"Processed: {save_path}")

def process_folder(folder):
    for filename in os.listdir(folder):
        if filename.lower().endswith(".png"):
            input_path = os.path.join(folder, filename)
            output_path = os.path.join(folder, f"processed_{filename}")
            straighten_and_crop(input_path, output_path)

# USAGE
process_folder("unrotated")  # Change this to your folder
