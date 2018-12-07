---
layout:     post
title:      DXR-RTX Path Tracer Project User Guide
date:       2018-12-06 12:32:18
summary:    DXR-RTX Path Tracer Project User Guide
categories: DXR
thumbnail:  "/assets/images/posts/2018-12-06-Usage/thumbnail.jpg"
tags:
 - C++
 - RTX
 - DXR
 - DirectX12
---

## Information
- [Github Repo](https://github.com/rtx-on/rtx-explore)
- [My github](https://github.com/Maknee)
- [My twitter](https://twitter.com/makneee)

## Links to series
- [DXR Path Tracer Introduction]({{ site.baseurl }}{% link _posts/2018-12-06-RTX-DXR Path Tracer.md %})
- [DXR Path Tracer Usage]({{ site.baseurl }}{% link _posts/2018-12-06-RTX-DXR Path Tracer User Guide.md %})
- [DXR Path Tracer Host-Side Explanation]()
- [DXR Path Tracer HLSL Explanation]()

## Building the project

<img align="center" src="/assets/images/posts/2018-12-06-Usage/building.jpg" width="35%">

The required environment and building instructions are on the [github repo](https://github.com/rtx-on/rtx-explore)

To start, download the project.

Open it in visual studio and click the green `Debug` button, or switch to `Release` for better performance. This should *hopefully* run the project. Let us know if it does not run.

## Basic Usage

*Images subject to change as project develops*

When the application starts, you will be presented with this screen:

<img align="center" src="/assets/images/posts/2018-12-06-Usage/start.png" width="100%">

As one can see, there are multiple headers. We will go through each one.

### Features

<img align="center" src="/assets/images/posts/2018-12-06-Usage/features.png" width="100%">

Features are different effects one can apply. In the image above, anti-aliasing is enabled, but depth of field is not.

<img align="center" src="/assets/images/posts/2018-12-06-Usage/update.gif" width="100%">

To apply changes, press the `Update` button. You will see this button often.

### Models

<img align="center" src="/assets/images/posts/2018-12-06-Usage/models.png" width="100%">

In this header, you can see the models loaded in the screen. Each object points to one of these models or none at all.

You can view the vertices and indices of the model as well.

<img align="center" src="/assets/images/posts/2018-12-06-Usage/vertices-indices.gif" width="100%">

### Materials

<img align="center" src="/assets/images/posts/2018-12-06-Usage/materials.png" width="100%">

In this header, materials define certain properties of an object.

For example, an object could be reflective, refractive or have emittance.

<img align="center" src="/assets/images/posts/2018-12-06-Usage/materials.gif" width="100%">

You can also make an empty material and edit it. 

<img align="center" src="/assets/images/posts/2018-12-06-Usage/materials-empty.gif" width="100%">

### Diffuse Textures

<img align="center" src="/assets/images/posts/2018-12-06-Usage/diffuse-textures.png" width="100%">

Diffuse textures are color textures. The `wahoo.bmp` texture makes mario look like... mario instead of a colorless mario?

You can view the raw 2D texture image under `Raw Texture`

<img align="center" src="/assets/images/posts/2018-12-06-Usage/raw-diffuse-texture.gif" width="100%">

You can also add a diffuse texture by clicking on `Add Texture`

This pulls up a file dialog where you can select a texture to upload

### Normal Textures

<img align="center" src="/assets/images/posts/2018-12-06-Usage/normal-textures.png" width="100%">

The normal textures are exactly like diffuse textures. You can view the raw 2D texture and upload a normal texture.

<img align="center" src="/assets/images/posts/2018-12-06-Usage/raw-normal-texture.gif" width="100%">

### Objects

This is where stuff starts to get more interesting. Objects are essentially instances of models (if you're familiar with [top level and bottom level acceleration structures](https://devblogs.nvidia.com/introduction-nvidia-rtx-directx-ray-tracing/), you will understand why this is so)

<img align="center" src="/assets/images/posts/2018-12-06-Usage/objects.png" width="100%">

Click on one of the objects to edit it.

<img align="center" src="/assets/images/posts/2018-12-06-Usage/object-edit.png" width="100%">

You have the ability to `transformation` the object by editing the `translation`, `rotation` and `scale` by dragging the slider or double clicking the value and editing the value manually

<img align="center" src="/assets/images/posts/2018-12-06-Usage/object-transform.gif" width="100%">

Below the transformation, we have a reference to the model, material, diffuse texture, and normal texture (if they are referred to)

For example, in this case, mario doesn't have a `normal texture`. Mario has his normals taken from `wahoo.obj` file that was read in under `models`

Moving on, we have the `Select ...` buttons

These buttons allow you to change the model, material and textures the model is referring to.

For example, if I were to select the `crate.obj` under `Select model`, then the model would become the `crate` instead, which is essentially a cube.

<img align="center" src="/assets/images/posts/2018-12-06-Usage/crate.gif" width="100%">

It looks a bit funny with mario's textures :)

### GLTF

One can upload a GLTF file!

<img align="center" src="/assets/images/posts/2018-12-06-Usage/gltf-upload.gif" width="100%">

This adds `models`, `objects`, and possible `material` and `textures` if they exist in the gltf file.

At the minimum, the gltf loader will load one `model` and one `object` that points to that model

### Save/Load Scene File

This allows to you save your current scene and load it!

The paths put into the scene correspond to the `model` and `texture` names, so watch out if you move the texture!

The `material` is embedded into the scene file.

The `gltf` files are also embedded into the scene file

<img align="center" src="/assets/images/posts/2018-12-06-Usage/scene-save.gif" width="100%">

If you wish to edit the scene file manually, then it should be pretty much self explanatory as it is pretty basic :)

<img align="center" src="/assets/images/posts/2018-12-06-Usage/scene-edit-raw.gif" width="100%">

### Kewl RTX Image Comaparison Thing

Uh, I can explain --

~I couldn't think of a name for this~

What this does is allow you to save an image and then upload it to a percentage of the screen, so you can do a comparison

[An example of such a tool to play around with](https://www.polygon.com/2015/8/7/9115547/metal-gear-solid-5-the-phantom-pain-graphics-comparison)

First, save the scene as an image

<img align="center" src="/assets/images/posts/2018-12-06-Usage/image-save.gif" width="100%">

Then, load the scene image again

<img align="center" src="/assets/images/posts/2018-12-06-Usage/image-load.gif" width="100%">

Then you can play with the image

As you can see, the left is the original image and the right is the image with depth of field

<img align="center" src="/assets/images/posts/2018-12-06-Usage/image-load-play.gif" width="100%">

You can also make the slider automatic by pressing the `Auto Move Split Image Slider`

<img align="center" src="/assets/images/posts/2018-12-06-Usage/image-auto-move.gif" width="100%">

That might have been a bit hard to notice! Let's try again, but this time, the camera is moved forward

<img align="center" src="/assets/images/posts/2018-12-06-Usage/image-auto-move2.gif" width="100%">

You can actually save the screen with the comparison as well!

<img align="center" src="/assets/images/posts/2018-12-06-Usage/image-save-comparison.gif" width="100%">
<img align="center" src="/assets/images/posts/2018-12-06-Usage/image-read-comparison.gif" width="100%">

### That's all for now!

You should be now ready to make super-duper awesome RTX-DXR On 2080 images :)

<p align="center">
<iframe src="https://giphy.com/embed/5BTyQlNh8Ugmc" width="480" height="374" frameBorder="0" class="giphy-embed" allowFullScreen></iframe><p><a href="https://giphy.com/gifs/thumbs-glitch-way-5BTyQlNh8Ugmc">via GIPHY</a></p>
</p>



