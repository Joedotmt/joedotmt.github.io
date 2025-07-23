import os
from PIL import Image

# Define base directory and rotation folders
base_dir = 'unrotated'
rotation_folders = ['90', '-90', '180']

# Loop through each folder
for folder in rotation_folders:
    folder_path = os.path.join(base_dir, folder)
    rotation_angle = int(folder)

    # Process each PNG file in the folder
    for filename in os.listdir(folder_path):
        if filename.lower().endswith('.png'):
            file_path = os.path.join(folder_path, filename)

            # Open image and rotate
            with Image.open(file_path) as img:
                rotated_img = img.rotate(-rotation_angle, expand=True)  # negative to rotate correctly (Pillow uses counter-clockwise)

                # Save to base "unrotated" folder
                output_path = os.path.join(base_dir, filename)
                rotated_img.save(output_path)

print("Rotation complete.")
