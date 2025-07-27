import math
import numpy as np
from PIL import Image, ImageDraw
import matplotlib.pyplot as plt
import os

def slice_image_pizza_style(image_path, num_slices=8, offset_deg=0, save=False, output_dir='slices'):
    # Load image
    image = Image.open(image_path).convert("RGBA")
    width, height = image.size
    center = (width // 2, height // 2)
    radius = min(center)  # Ensures slices stay inside the image circle

    angle_per_slice = 360 / num_slices

    # Preview setup
    fig, axs = plt.subplots(1, num_slices, figsize=(2 * num_slices, 2))
    if num_slices == 1:
        axs = [axs]

    slices = []

    for i in range(num_slices):
        angle_start = offset_deg + i * angle_per_slice
        angle_end = angle_start + angle_per_slice

        # Create mask
        mask = Image.new("L", (width, height), 0)
        draw = ImageDraw.Draw(mask)
        draw.pieslice(
            [center[0] - radius, center[1] - radius,
             center[0] + radius, center[1] + radius],
            start=angle_start, end=angle_end, fill=255)

        # Apply mask to the original image
        slice_img = Image.composite(image, Image.new("RGBA", image.size), mask)

        # Auto-crop transparent borders
        alpha = slice_img.split()[-1]
        bbox = alpha.getbbox()
        if bbox:
            slice_img = slice_img.crop(bbox)

        slices.append(slice_img)

        # Preview
        axs[i].imshow(slice_img)
        axs[i].axis('off')
        axs[i].set_title(f'Slice {i+1}')

    plt.tight_layout()
    plt.show()

    if save:
        os.makedirs(output_dir, exist_ok=True)
        for idx, slice_img in enumerate(slices):
            slice_img.save(os.path.join(output_dir, f'slice_{idx+1}.png'))
        print(f"Saved {num_slices} slices to '{output_dir}/'")

# Example usage
if __name__ == "__main__":
    slice_image_pizza_style("tonda.png", num_slices=31, offset_deg=3, save=True)
