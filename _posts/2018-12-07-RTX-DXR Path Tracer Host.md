---
layout:     post
title:      DXR-RTX Path Tracer Project Host Code
date:       2018-12-07 12:32:18
summary:    DXR-RTX Path Tracer Project Host Code
categories: DXR
thumbnail:  "/assets/images/posts/2018-12-07/thumbnail.jpg"
comments:   true
tags:
 - C++
 - RTX
 - DXR
 - DirectX12
---

## Information
- [Rtx-explore github repo](https://github.com/rtx-on/rtx-explore)
- [Slides](https://github.com/rtx-on/rtx-explore/tree/master/Milestones)
- [Presentation](https://www.youtube.com/watch?v=QZiQ-c8jtgY&t=29m30s)
- [My github](https://github.com/Maknee)
- [My twitter](https://twitter.com/makneee)

## Links to series
- [DXR Path Tracer Introduction]({{ site.baseurl }}{% link _posts/2018-12-06-RTX-DXR Path Tracer.md %})
- [DXR Path Tracer Usage]({{ site.baseurl }}{% link _posts/2018-12-06-RTX-DXR Path Tracer User Guide.md %})
- [DXR Path Tracer Host-Side Explanation]({{ site.baseurl }}{% link _posts/2018-12-07-RTX-DXR Path Tracer Host.md %})
- [DXR Path Tracer HLSL Explanation]({{ site.baseurl }}{% link _posts/2018-12-08-RTX-DXR Path Tracer HLSL.md %})

## What do you mean by host side?

The host side of the project is working with C++ and [DXR](https://blogs.msdn.microsoft.com/directx/2018/03/19/announcing-microsoft-directx-raytracing/)/[DirectX12](https://docs.microsoft.com/en-us/windows/desktop/direct3d12/what-is-directx-12-) API and managing the communication with the GPU and CPU and resources. This post will describe how the DXR Path Tracer project is setup as I worked mainly on the host side of the code base.

## Direct Love/Pain

DirectX 12 is awesome. A programmer can actually manage the resources to communicate between the CPU and GPU and describe the resource in any way he/she prefers

This allows for tons of performance and removes overhead for having the driver manage the resource

However, on the other hand, DirectX 12 can make you pull your hair out because either you're missing a parameter or missing a call. The API is verrrrrrrrrrryyyyyyyyyyy explicit.

{% include image.html path="/assets/images/posts/2018-12-07/directx-12.jpg" width="35%" %}

## Experience with DirectX 12

My knowledge of Directx 12 is no where near that of a seasoned graphics programmer. I have only pretty used opengl and cuda before, but I can say I did learn a lot about the API in these last four weeks I've worked on the project :)

I will try to explain the host code at a high level to the best of my ability and if anyone has any questions, I'll be happy to answer. If anyone has any suggestions, that would be awesome!

If you want great tutorials for an intro to DirectX 12, take a look here:

- [3DGEP Tutorial](https://www.3dgep.com/learning-directx12-1/)
- [Braynzar Tutorial](https://www.braynzarsoft.net/viewtutorial/q16390-04-directx-12-braynzar-soft-tutorials)

## Root Signature/Parameters and Heap descriptor layout

{% include image.html path="http://www.braynzarsoft.net/image/100204" width="100%" %}

*Some of these images are from [3DGEP Tutorial](https://www.3dgep.com/learning-directx12-1/) and [Braynzar Tutorial](https://www.braynzarsoft.net/viewtutorial/q16390-04-directx-12-braynzar-soft-tutorials), so shoutout to them for the some of the best tutorials on directx12 and image*

In DirectX12, one needs to create a [root signature](https://docs.microsoft.com/en-us/windows/desktop/direct3d12/root-signatures) that describes the parameters that are passed to the [hlsl](https://docs.microsoft.com/en-us/windows/desktop/direct3dhlsl/dx-graphics-hlsl) shader code, which is where the magic happens.

The root signture is sort of like a [function signature](https://www.csee.umbc.edu/~chang/cs202/Lectures/modules/m04-overload/slides.php?print) in C/C++, which defines the parameters that are passed to the function.

So, how does one allocate these so called "parameters" and hook them up with the root signature? One uses a [descriptor heap](https://docs.microsoft.com/en-us/windows/desktop/direct3d12/descriptor-heaps)

~~I'm sorta skipping myself ahead here, but here is the image of how the path tracer's resources are allocated and I will explain what is happening after

{% include image.html path="/assets/images/posts/2018-12-07/DXR-Layout.svg" width="100%" %}

*You probably want to open the image by right clicking it and selecting open in new tab to get a clearer picture :)*

In the image, the root signature contains two entries. One is a [descriptor table](https://docs.microsoft.com/en-us/windows/desktop/direct3d12/descriptor-tables-overview) and the other is an array of [samplers](https://cglearn.eu/pub/computer-graphics/textures-and-sampling), which points to different samplers to grab values from a texture

A descriptor table (in this case), is describing all the parameters (resources) that are going to passed to the hlsl shader code.

{% include image.html path="http://www.braynzarsoft.net/image/100209" width="50%" %}
{% include image.html path="http://www.braynzarsoft.net/image/100208" width="50%" %}

Each entry in the descriptor table is a descriptor range, which contains the number of entries in the descriptor heap that should be bound to the entry and what [space](https://docs.microsoft.com/en-us/windows/desktop/direct3d12/resource-binding-in-hlsl) the entry should be in (why spaces are used is explained in the HLSL post).

For the project, I have descriptor range entries for `vertices`, `indices`, `materials`, `objects`, `diffuse textures`, and `normal textures`. These ranges point to an entry in the descriptor heap and contain the number of elements from the start of the entry in the descriptor heap. They also describe the type of resource being used.

Next, we have the [descriptor heap](https://docs.microsoft.com/en-us/windows/desktop/direct3d12/descriptor-heaps), which contains [handles](https://docs.microsoft.com/en-us/windows/desktop/api/d3d12/ns-d3d12-d3d12_cpu_descriptor_handle), which are opaque pointers to the resource, sorta like a [FILE](http://www.cplusplus.com/reference/cstdio/FILE/), in C, where one should not access the contents, or dereference the object. One *should* only pass the handle to function calls.

Now, to the [resources](https://docs.microsoft.com/en-us/windows/desktop/api/d3d12/nn-d3d12-id3d12resource), which are abstractions that wrap data and can be on the CPU or on the GPU

These resources point to actual data, which could be vertices, textures, materials, etc..., as shown in the image.

`Objects` are kind of unique here. They provide yet another indirection to the `vertex`, `texture`, `material` resource by having an offset those particular resources. You can see in the hlsl post how the offsets are used.

So, how does hlsl shader part come in?

<p align="center">
<iframe src="https://giphy.com/embed/8lQyyys3SGBoUUxrUp" width="480" height="480" frameBorder="0" class="giphy-embed" allowFullScreen></iframe><p><a href="https://giphy.com/gifs/andrea-8lQyyys3SGBoUUxrUp"></a></p> 
</p>

Well, when the [command list](https://docs.microsoft.com/en-us/windows/desktop/direct3d12/recording-command-lists-and-bundles) sets the [root signature](https://docs.microsoft.com/en-us/windows/desktop/api/d3d12/nf-d3d12-id3d12graphicscommandlist-setcomputerootsignature) and the [descriptor table](https://docs.microsoft.com/en-us/windows/desktop/api/d3d12/nf-d3d12-id3d12graphicscommandlist-setcomputerootdescriptortable) associated with the signature, which essentially binds the root signature with the actual heap table resources and executes the command list, the resources are available in the hlsl code!

So in theory, if one wanted to access the first diffuse texture, it can be done as so:

{% highlight cpp %}
    Texture2D text[] : register(t0, space5);
    
    ...
    
    Texture2D first_texture = text[0];
{% endhighlight %}

<p align="center">
<iframe src="https://giphy.com/embed/xT0xerduMfvL0GL7TG" width="480" height="270" frameBorder="0" class="giphy-embed" allowFullScreen></iframe><p><a href="https://giphy.com/gifs/nba-expression-russell-westbrook-xT0xerduMfvL0GL7TG"></a></p>
</p>

Wow, that was a lot to explain. Hopefully, you get an idea of what was done!

If something is missing or not explained very well, shoot me a message! I'll be happy to answer.

## Acceleration Structures

<p align="center">
<iframe src="https://giphy.com/embed/wRimw2I5PWErm" width="480" height="321" frameBorder="0" class="giphy-embed" allowFullScreen></iframe><p><a href="https://giphy.com/gifs/initial-d-nakasato-takeshi-wRimw2I5PWErm"></a></p>
</p>

*Initial D, gotta accelerate*

Well moving on to more specific API calls to DXR/RTX, which is building the [acceleration structures](https://devblogs.nvidia.com/introduction-nvidia-rtx-directx-ray-tracing/), which is nicely explained in this [post by Nvidia](https://devblogs.nvidia.com/introduction-nvidia-rtx-directx-ray-tracing/)

{% include image.html path="https://devblogs.nvidia.com/wp-content/uploads/2018/03/raytrace_02-625x383.png" width="50%" %}

*image taken from the [Nvidia post](https://devblogs.nvidia.com/introduction-nvidia-rtx-directx-ray-tracing/)

In the DXR Path tracer, it's pretty much exactly the same as what is described in the post

For each model, create the bottom level acceleration structure and have a geometry descriptor that points to the vertices and indices resources

*Pseudo-ish code of the source is shown below. The code is not exactly the source, since I want readers to get a general sense of what was done and not read verbose C++ code.

{% highlight cpp %}
    //Geometry that describes the vertices and indices the bottom level acceleration structure will hold
    geometryDesc.Type = D3D12_RAYTRACING_GEOMETRY_TYPE_TRIANGLES;
    geometryDesc.Triangles.IndexBuffer = indices.resource->GetGPUVirtualAddress();
    geometryDesc.Triangles.IndexCount = indices_count;
    ...

    geometryDesc.Triangles.VertexBuffer.StartAddress = vertices.resource->GetGPUVirtualAddress();
    geometryDesc.Triangles.VertexCount = vertices_count;
    ...

    //Get PreBuild information
    m_dxrDevice->GetRaytracingAccelerationStructurePrebuildInfo(..., &bottom_pre_build_info);
    ...

    //update the descriptor
    bottom_acceleration_descriptor.pre_build = bottom_pre_build_info;

    //Build the Acceleration Structure with the command list
    rtxCmdList->BuildRaytracingAccelerationStructure(&bottom_acceleration_descriptor, ...);
{% endhighlight %}

Then, for the top level, there are instances, which do the following:

- hold the model transformation matrix (translation, rotation, scale)
- hold the instance id (which is the object's index) and is passed to the HLSL shader code (the usage will be explained in the HLSL post)
- hold a handle to the bottom level acceleration structure

{% highlight cpp %}
    //Build the instances
    std::vector<D3D12_RAYTRACING_FALLBACK_INSTANCE_DESC> instanceDescArray;
    for (int i = 0; i < objects.size(); i++) {
        D3D12_RAYTRACING_INSTANCE_DESC instanceDesc = {};
    
        SceneObject obj = objects[i];
        Model* model = obj.model;
    
        memcpy(instanceDesc.Transform, obj.getTransform3x4(), 12 * sizeof(FLOAT));
        
        instanceDesc.InstanceID = i;
        instanceDesc.AccelerationStructure = model->bottom_level_acceleration_structure);
        ...
    }
    ...

    instanceDescResource = AllocateCBV(instanceDescArray, ...);
    ...

    //Get PreBuild information
    m_dxrDevice->GetRaytracingAccelerationStructurePrebuildInfo(..., &top_pre_build_info);
    ...

    //update the descriptor and make sure that the descriptor points to the instanceDescArray
    top_acceleration_descriptor.pre_build = top_pre_build_info;
    top_acceleration_descriptor.Inputs.InstanceDescs = instanceDescResource->GetGPUVirtualAddress();
    ...

    //Build the Acceleration Structure with the command list
    rtxCmdList->BuildRaytracingAccelerationStructure(&top_acceleration_descriptor...);
{% endhighlight %}

Then, at the end, before executing the command list, and running the hlsl code, the top level acceleration structure is binded to the command list

{% highlight cpp %}
    commandList->SetComputeRootShaderResourceView(
        GlobalRootSignatureParams::AccelerationStructureSlot,
        m_topLevelAccelerationStructure->GetGPUVirtualAddress()
    );
{% endhighlight %}

<p align="center">
<iframe src="https://giphy.com/embed/yJFeycRK2DB4c" width="480" height="384" frameBorder="0" class="giphy-embed" allowFullScreen></iframe><p><a href="https://giphy.com/gifs/yJFeycRK2DB4c"></a></p>
</p>

Well, that's all I have for now. Hopefully more people are going to get into the awesome DXR API and build amazing applications with it!

Let me know if you have any questions!
