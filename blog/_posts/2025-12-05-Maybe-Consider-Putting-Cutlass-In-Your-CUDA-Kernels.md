---
layout:     post
title:      Maybe consider putting "cutlass" in your CUDA/Triton kernels
date:       2025-12-12 06:00:00
summary:    CUDA
categories: CUDA
thumbnail:  "/assets/images/posts/2025-03-13/thumbnails/thumbnail-2.png"
comments:   true
tags:
 - CUDA
jupyter:    true
mermaid:
    enabled: true
    zoomable: true
---

# Motivation

So I was browsing Hacker News and came across this interesting post: [Fp8 runs ~100 tflops faster when the kernel name has "cutlass" in it](https://news.ycombinator.com/item?id=45458948). 

This was from Triton tutorial where someone noticed that adding "cutlass" to their kernel name gave them an additional 100-150 TFLOPs. That's a huge improvement just from... a name?

{% include image.html path="/assets/images/posts/2025-12-05/original1.png" width="120%" text="Mentions 100 TFLOPs improvement" url_source="https://github.com/triton-lang/triton/pull/7298" url_text="Github pull" %}

{% include image.html path="/assets/images/posts/2025-12-05/original2.png" width="120%" text="Mentions 150 TFLOPs improvement by renaming triton kernels to add cutlass" url_source="https://github.com/triton-lang/triton/pull/7298" url_text="Github pull" %}

Well, I got a bit curious and wanted to why this happens.

# So... what exactly is this?

Instead of writing your kernel like this:

```cpp
__global__ void add(float *sum, int n, float *x, float *y)
{
  for (int i = 0; i < n; i++)
    sum[i] = x[i] + y[i];
}
```

You add "cutlass" to the name:

```cpp
__global__ void add_cutlass(float *sum, int n, float *x, float *y)
{
  for (int i = 0; i < n; i++)
    sum[i] = x[i] + y[i];
}
```

and `ptxas`<span class="sidenote-ref"></span><span class="sidenote">If you need some background on the CUDA compilation toolchain, refer to the [section on nvidia toolchain background](#nvidia-toolchain-background)</span> will perform an additional pass that can add performance to the generated code.

The rest of this blog will show benchmarks, explain the optimizations, and discuss when to use this trick. But I also want to highlight something broader: if you're working at the high level (CUDA, Triton, PyTorch), you're still at the mercy of what the backend compilers decide to do. In this case, ptxas (a black box) is making optimization decisions based on your kernel's name<span class="sidenote-ref"></span><span class="sidenote">With the recent release of [TileIIR](https://docs.nvidia.com/cuda/tile-ir/sections/introduction.html), there's still plenty of magic happening under the hood. `tileiras` is also a black box, so we could easily see a similar "cutlass" trick emerge there too</span>.

[If you want to skip to TLDR of the optimization, click here](#so-what-is-it-doing)

## A cutlass example

Here's an example graph showing cutlass benchmarks with and without this optimization (where `baseline/cutlass_on` enables the optimization and `cutlass_off` disables it):

{% include image.html path="/assets/images/posts/2025-12-05/main_example.svg" width="120%" text="Throughput of various cutlass examples"%}

In particular, the [CuTE sgemm2.cu](https://docs.nvidia.com/cutlass/media/docs/cpp/cute/0x_gemm_tutorial.html#sgemm-2-cu) [example](https://github.com/NVIDIA/cutlass/blob/v4.3.0/examples/cute/tutorial/sgemm_2.cu) sees a 20% drop in performance without the cutlass optimization!

Another thing immediately obvious is that this optimzation doesnt always increase performance.

# Benchmarks

Below are sections you can expand to see various benchmarks running on an RTX 3090 and H100. Each result is aggregated from 5 benchmark runs.

Benchmarks include 15+ projects, covering popular ones like PyTorch, Flash Attention 2/3, Cutlass, llama.cpp.

Some highlights:

* Running llama.cpp on RTX 3090 with gpt-oss-20b shows a 1%+ performance increase
* Flash Attention 2 on RTX 3090/H100 without the optimization decreases performance by up to 1%
* Triton on RTX 3090 generally shows no performance change from the optimization

Note: `baseline` doesn't change anything. `cutlass_on` enables the optimization and `cutlass_off` disables it (if the application uses `cutlass`, for example Flash Attention 3):

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to see 3090 benchmarks</summary>

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    padx="2"
    pady="2"
    id="benchmark-3090-table"
    show_calculations="false"
    headers="GPU,Benchmarks"
    data="RTX 3090 (Ampere),bitsandbytes, candle, cutlass, flash_attn2, flashinfer, ggml, liger, llamacpp, llmc, mojo, nccl, pytorch, sageattention, sgemm, sglang, tilus, tinygrad, torchao, triton, unsloth, vllm"
%}

{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/bitsandbytes_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/candle_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/cutlass_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/flash_attn2_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/flashinfer_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/ggml_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/liger_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/llamacpp_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/llmc_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/mojo_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/nccl_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/pytorch_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/sageattention_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/sgemm_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/sglang_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/tilus_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/tinygrad_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/torchao_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/triton_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/unsloth_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/ampere/vllm_comparison.png" width="100%" %}

</details>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to see H100 benchmarks</summary>

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    padx="2"
    pady="2"
    id="benchmark-h100-table"
    show_calculations="false"
    headers="GPU,Benchmarks"
    data="H100 (Hopper),bitsandbytes, cutlass, deepep, deepgemm_tflops, flash_attn2, flash_attn3, flashinfer"
%}

{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/hopper/bitsandbytes_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/hopper/cutlass_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/hopper/deepep_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/hopper/deepgemm_tflops_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/hopper/flash_attn2_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/hopper/flash_attn3_comparison.png" width="100%" %}
{% include image.html path="/assets/images/posts/2025-12-05/benchmarks/hopper/flashinfer_comparison.png" width="100%" %}

</details>

# So what has it changed?

So, I've added a godbolt reference for people to see the difference. I'm using some parts of [SGEMM_CUDA](https://github.com/siboehm/SGEMM_CUDA/blob/master/src/kernels/9_kernel_autotuned.cuh)<span class="sidenote-ref"></span><span class="sidenote">If you haven't checked it out, it's [a great blog](https://siboehm.com/articles/22/CUDA-MMM) on optimizing cuda matmul kernels by Simon Boehm</span> as reference.

In the NVCC compliation pipeline, cuda goes to ptx then ptx goes to sass. Let's check verify where this optimization is applied (is it applied at the ptx or sass code)?

{% include image.html path="/assets/images/posts/2025-12-05/gpu_compilation.svg" width="100%" text="High level compilation overview for NVIDIA GPUs" %}

First let's explore if the cuda to ptx has changed.

{% include image.html path="/assets/images/posts/2025-12-05/cuda_to_ptx.svg" width="140%" text="There's no difference in the PTX!" url_source="https://godbolt.org/z/bcfj8ovrc" url_text="Godbolt link" %}

Only the name has changed. The PTX instructions are identical.

So let's now check the the sass [Godbolt link](https://godbolt.org/z/erc4e8M17):

<div style="
  width: 90vw;
  margin-left: calc(50% - 45vw);
  margin-right: calc(50% - 45vw);
">
  <iframe
    src="https://godbolt.org/e#z:OYLghAFBqd5QCxAYwPYBMCmBRdBLAF1QCcAaPECAMzwBtMA7AQwFtMQByARg9KtQYEAysib0QXACx8BBAKoBnTAAUAHpwAMvAFYTStJg1DIAruiakl9ZATwDKjdAGFUtEywYgATKUcAZPAZMADl3ACNMYgkAVgA2UgAHVAVCOwYXNw9vROTUgQCg0JYIqK44y0xrWwEhAiZiAgz3Tx8rTBs02vqCApDwyJj4hTqGpqzWkZ7AvuKBstiASktUE2Jkdg4AUg0AQU2vAGZA5DcsAGpNg6dTcwB9YhNBPDYAOgRL7G293f2jqiwqGcnHIACp%2BHZCIRfX4A6ZnADS2AASsFsH5bsEdgBZbAQZhsBZnUwEAwKBS3X6/fGYaGHSpKWkHWFBBHI1HozE4vGsTCE6mMxx4KjQn6HZmYM4AdR2SOUQgAkgAtbBnA5eRnioHYeXogAi8oAahAsaQzsFCVBjYT9gAhM4Qc0AWi4hIA9PbzQsRTtXe7Hf6A4Gg8GQ6Gw%2BGIxGvr6zgb2kRiHgAF6YdBnYC0VBhMSOj4KBD1VNnTNMNMISoJSIKe38NYSvy6gDiLy4XgAHK6hCChC322dAmchBChF7djHIxPJ1PpyGvgRMCwEgZ55cnIECGcbSb%2B4JN8FTevN/CD7viKgAO61RNYHYnjdny8Ea%2BYG0fL63W5YABueHWH7OX6oHgaYlugABiZ4sI2bAsBAaAMMMZxUCWBAAFRnLeRICIhyGoEwaGbneCJEfuXxnORFGUVR1E0UhKHoTsCimrh%2BHoTaTFkbRXHcTuG6BEExBIhemGHvxkQZLenE8dJlGiQwAlCeeNpEWJxAZDa1oAOyvrs5ExqBGFnLY9Cmk%2BhgKEkShpuuqBnPmhboJxvwJMQTDACwTBnI8Z60LQnG1vah6oFQgKXLqZwaJcdrBaFXh2g%2BV7AZgOwXFcYWbliUVnDFFxxelCVPklOxaTpKUUSxBCSABqXhcQmDrpELmYAQtyiMMq7wThKGSKhHwQFJVH7LEezRDaECqYpKW2tlIWEuh8K5XaqkSWc6GSJs0S6l6o2RZtUUDYxG1jctrgpWti0RXNGUXRNwkXTFG3helX4vKo%2B26RRh2jeN8niadq1nFV00ugDW43b9gl3dND2bTVAEvAAnu9ZXkV9x0Qyt53TV4V1g9Nt3nlNcUzcKsPPS8SbI5RaM/QJmOAxdBy41i4MKVDxMw09BzhS955Uxcmm6px%2Bl4WmdrGZgpq0NM9TFkwCMrAQTmHC5bkeV5DA%2BX5H0BT9G45elkUHNFIUXQVz52qu6U2vCWUG3l3NnObSUaQLpWUXVDXEE1LVtUrVwVT1fVDexR205EimWxzs2g8ErN/bQdprY9202rtXNCx91Ge4IjV1b7TDtVcnUboHvUHLiA20SHYcE1HJtUFdcf4xjrhJ4DKdHen/ObIL0J9z8Y5%2BjOI%2Bj2P/rRu6kr1AkroKCYYSOueM9O5gwB4MMkSOmEmbIAA1kWHkECwJi0EhkF2QWdVphLCiT2c4%2BP0/Ua7POi7LjSVyHluRE2vuvFHiIpKbch5JT/1AVieUIJkRAOCFAmBVdZK7klEIOQP8AEoLQeA3cIIQE4OCG%2BXYH5vy/kwP%2BQCwEzguVQOsMkEFUAsCEDBag9FV7AG3BVdCdVgD/04UZBAdVSxIkwPPWgBAOJZxklI8iJc6J4QIoxU0si%2BHsVIIg6RPETCHmXt7RSpotG7h0QkDIajJEaOkgYjcBABGYCEReeUDBp7e30YeaxgjnCuAcU4hIJVlYHFVu5Ty3lXDazKrrSxZx0CoA3IbLKUSYlXCPFlW0tp4m%2BMkc5VygSNZawGuEw8xA4ZG3iqlJwUpIHQKRMkvKcViCjhRhRTJasgmaxCYg/Ju48BFKyl01cZxcHVNfHFPA9TaLcMyqNQp6FcE3UenDNG8TQYs2mkYxSANgFm3WagvGeUzHmNom42x6BFJeJXtM5ZxM8CPWRgNJp2Tgm%2BTySQe0ETkDdONkSUpUo4GVMGbaZAozBoqyyerB5oTqIdL4u8paXyQQEI%2BSk4ZgLs5rwIaNN50zm6XLmdbO%2Bo1FlsSxXaIxGR1lEs%2BehTBf9FrqP2VRQ5pYMinO9gDOFsy9rG29JRO5oLWmPMkZCp20KhV9OAfAqpCKak2jqYgnlLTcl7MFW82JHzlWJLAeKv5cUAW0rlTktpezyKCt6Y7Yp/ZYWZUlUMm0IzaXkT1WCu1SFnkQAidoYV7q%2Blwq1TabQyKuIMuOSI0%2B4iw5TP6RcpaV0IAasqay80F0MX9PJdoHFDtM4NOkuMo64aZn4zmVw1FR0k1sumqmjl7sBYZt7tWoeD9n4NsbbmOtWImADiMY6YygRgBnAPsQIIZ8IBH2QOWasChgALhYLlLwfaB1nC4JFLwXgsIMBoD2gKCgWC3AAJwaCYPU8cTaj3jznAuJc%2BFP5rl3Og7%2B2CNw2yAXgjcYDYHiqIrg99pFDXkUPMEOQWJbgggABJImwDsXUUIK7vk/JgH8f5bhnA/LWdYgRpZBHIUBNM47J23CMV2owtxnhLjgthUurCPx1WGImGw/5JLfrpQxmiyjyP3BEYVGjCHlJOsYzxuRrFEOsao7%2BFqCGnCmMzbxyTP7dxPrNEReE6SyqyNeWs9KO8aF73lOgVQiN%2BbKcPMgUland6ae069G5H19OGJnlp1QcNA22demcKeMo5RKk%2BJyyzpGvLaJnkZx2RjbO5WiPaalU9zR6e8xE1ZF44aBe0850Lcdwtek898JTpHMCqBcj55BFTkRwxjSzSlCb3QxtcwqZUrLivJrJeK1LlaS5ZZyxEqlyzHYbKnvliVjXMvZcKa17ZzcOvJe%2BZqtLnErNWOAsyhI9mbGlkc3Z/YIXpSykqx53rCENwRMDUyxxK90q2HQLN4L9oqWjbhQ1ybUXXELeOfYg7LKjszae3NsrF3EtXYs2VD89lr7/gqhhPFNowZsVthWzif2r6pkByhTcIObax2uRNrz23ct8QhpNeb7iluJYgEj90khrto8QhEk6tApqOwc2Z5bXgQsE4WkTknGXtvNYGwUi8iUbyFb/QB4DoHwNCABsTxLNsfsyNu50rHF5LbU/u3jsrYXAYs8l%2Bj8nrdE446OXjlbSXEvE8i2z/rGOnZc8KlgOX4U%2BeAZA2BiD%2BPleG9R2E%2BHgbhGiNDaNMVcbzl1d98mnFjte5pxrfzIH2bvfdeq0Hp62lIp9zS0a%2BH3C0U2ljQVzFse3YJ6Fi7tXXV5EMR3nveZF04JrLYliK6tsk8rsL/xm0Je4b1yJKSwl4fWFOGb%2BlMp00K%2BxarxdGL551nV4BuSwzrhY7D789PkrEvnWFNdYeMIpeVV2jX18lfggFi183%2Bv9NR5FOUVAvQqCMFVzoL/qaB9ZvHzPkws7S3fUdgl9v%2B/4icnge34kRJqTPGBMIkmudG/%2BABDGdcJ4dMbcquFEf2CMDANg92CgEAsB5E1CtCCg5%2BTCC4V%2B24N%2BgC5SpoL65Sb6Y2lSxB2y24F2poH6geFc/U364ypoqepk92HuIaTEP%2BCOpoI%2BvBc%2BtA4mBy7Bj23ibB7i%2B23iaBGEPeR%2B4ude5ETetAh%2Br4jsSO6E8Kla5E8BiBgaKBsBYeg8ZUDqfK4KS%2BLyBSwqhSoq3WPqMqGSwKzS%2Bq/KDSSqwqaqZSGePWNK2qJ%2BVEfCLgJgCS4U3eyhmylKVBE%2BiaWyWC/M3Kjh9yph7SLq5OwqJqZSAyVqtotq36JhCqYBgqnqpqWURRGRmhZwnqR%2BouIeTqgc1U%2BU9Uuc3s%2BcrUhc/sTgZcwc9GQKsQgRSs307uohZyEaN0TcNK3R3Ee2nib28aF05aW0XcKOWhTGUufECW6UEAuaka/Y0aXh8a1oxMJaKacRNEL0dOqh4U7uwaYiIOwE5xEUSxTqL0CMNK8u7iHBNxR0dxF0XAjx3RL0SYrxlx7B1xXuNq6xxM6okO/xLwo%2BKSbxRyHxYJ3x00BwfxYB5EOc84zRzUrRRcHR3U5clcExjSXgvRisYcgx54p2fu%2BMYxKSJJwhEh0x3isxZancO02eX4Jx3KA8DShhewfJ98LgiB%2BcEogQwwhgtg%2BEaQ/YWATwogZ8RAdkE6LAU6s6lQ86Gg9oOwsQGg%2BproQGC62pCQ%2BECA9SWW2JDA06Tg%2Bwy6H4GYWYYg/4H4BgjwI6twYQKwDA6A5ItwEArYbYhIFCaYiIKIaIGI2IuI2GaptwGptAtwC6CwjBDSzGReGESi3mKizEXeREsmd6CIfhMZW6eGdA3ahG78q4gZpo1Z868QZwsQ0gDZTZTZbYpoTZgZr%2Bt%2BpoYmZw24/8CmNygsHASwtAnA0QvAngHAWgpAqAnAwIuoKUtpUqdkKwdYuUBwPApABAmgI5Swe83gXALwBwkgsQsQ0QXAmk%2Bp26mksQBwmkmk%2BgnAkgk5u5s5nAvACgIAGg25u5SwcAsASA%2BAIU5AlA/AggIgYg7AUgMgggigKg6g05vAtACAX5PgKFCgwFVABACMlYIAj5GFlprkqACQ1QU5Q4kI9oaAi4QRZCu6FgdkW69FCwvAxAqFIABwpAbFmFQo2FuF7Aj53FRFTAJFZFnAFFwuJGNF84O6e6pom6sl%2B6I5T5HAE5pAU5M5c5HAuovFsYeAmA54kQZoBoTgZSXABwLwGgLYD89QI6YUCl9FD8aGjR/AD8CgawjogQjopFdmD8AAGj5YXLlLEAAI4mDRJRSOgADyaJZJYVEVHyX41YwQJlZlFlVlXANlaw7w3MDle6Tl0wgQrljo7lyAnlDA3lBAvljoAVVVQVQ08V/sNo0VsVoV4VTVD8uowIYIw4vAO5SFCwSw5YpYAwqBpAB5mk0QLwkgmku6hwZ5kgkgJ50gY5HAL56lb5Wln535v5A1pAAFUAMAiAIAJC6woFUlCQdAkQwQPInAKVpl866VLYvAp1GwygIIflVFDCCQtFilLFvg%2BACYwEeg4Fwgip0F0goN8Fagb5ugnFbQHQ9gEAjgYwngXAvgPpvQRQJQeglkeQ6QrgzQuNuQZFWN/QpQFQVQnQkwqNegCNZFXQDQZNswFNkpowhNWQ6NbNUwhQ5NEgSwT4mA9U6A35o545r5SF752lsGpCelBlRl91aVll1lEAuAhAzyvw6NQI31V11hhwTMfVf5%2B5IA0QmkLwbYkgN5sQbYbYepbYmkttGg0QKl61LA3gztGlvAW1lgO1/VWg/5R1EAQFMtZ1FAF1utN1bAd1qVj1ytW5r1nA71n1F1v1zFvAqY6t14INsgkF4gMFUNSgMNktugrQlQ8YaQDgPptN6N/g0w2NcwOQKQZF1djd%2BNzNONXNZdiNDAjNjQHNaNlN5dNQkw7dDd3NLd3No9pQAtdUwtotKlalntUtuoIdEoBo%2BlhlhSitsdGV9oatCYG5WtLgi4utG5OMhtA1Q1Ryo1Yta1vAbt9OG1kt3tX5P5ftylB1QdKAOt9AZAYd1Fl1v9IADAX4yAyA5lGgJg6NNAYiVYlAYQb5YQgQ9QCMnAW5SDzAxACMUVYQ2g8YaDvA1FbAggUVDAtAqDktWAYQJgwATgYgtAX53AL1C4hgGYGwM5%2BAdUHQX4Iib5WW7QtFBD5Aucq1M50sYQrkWDLgWAb5hUbtTDpAPDxAXpSgK9HkRgaGoAe1yEbkCg69BlUVlYU5W5oNudENsF8ghdiFM5Jd%2BgrDKAZgFg4jX5kASwolaQjDjotlOVuoeVnkjozlRVtkJVHlXlPl5ENVgV1YdpLVdpXtSjz4LjY1pphQt1HA295lcd9oDAtkxIpICg/19NFdyNVd/degtdvNLNxNTdaQLdeNpNddfNndVNw93QE9XdDNI9jTVTXNNNZTvT3QU9/Nywqw6wwzq1i9m10dD1mTu9eIuTQR%2BT/179g1pAw1WAUQY1q1rt7tT9mlH5Ptb9f5%2B1gdSAADut515zQDIDYDEDUDfAdA2JX5EACDktGDKDQj7zWDODeDNgQjRDjABApD5Db5VDNDdDvkjD8dLDGj7DL1eAXDtgPDjDM5/DxIGwW5DUojyFeAEjKD0jcL25iY8jW5SjKjmAajrDmjxzOjwAejG9hjjAQjpj4NEgkNsg0N1jOgHFdjRgDj5g%2BguLSTbjpFHjnAXj2V9lTF%2BVAThVq6wTpV5VlV1VtVqg9VS6sTS6nV3V4IkI8TkQiT8ASwKTIQaTxlMzT1mVcEizhcBTn5HTxTKN/TGN6AQz6N9TtTzrHr%2BQ3THdg93dvd7TLTPdXTlTfr49zrk9vrcwSwCga5YzLoC9Et%2BzHA5rStczeTtryzRtaz19mzt9Ozj9S9L9vtObB5Fll5S1Xgp5J50QbY26S60Qztq1BwybXtBzKzt9XgbbUtF9/tSwSjKQ9gkgQAA%3D%3D%3D"
    style="
      width: 100%;
      height: 800px;
      border: 0;
      display: block;
    "
    loading="lazy">
  </iframe>
</div>

Clearly something has changed!

Two common changes we can see are:

<!-- https://godbolt.org/z/7TKvhv4Gj -->

{% include image.html path="/assets/images/posts/2025-12-05/instruction_selection.svg" width="160%" text="The optimization now uses IMAD instead of HMMA to zero registers" %}

We can see that `IMAD` is used instead of `HMMA` for zeroing registers, which is neat!<span class="sidenote-ref"></span><span class="sidenote">Instead of using `tensor` units, we can use the `FP32` units to zero out the registers. Refer to [H100 SM Diagram](#h100-sm-diagram)</span>.

{% include image.html path="/assets/images/posts/2025-12-05/instruction_reordering.svg" width="140%" text="Enable interleaving LDS and FFMA" %}

We can see that `LDS` interleaved instead of being stacked together<span class="sidenote-ref"></span><span class="sidenote">This should be able to increase instruction level parallelism</span>

One thing that the disassembly doesn't show is the register pressure. This optimization may increase register pressure:

```bash
cuobjdump --dump-resource-usage baseline.cubin

  Resource usage:
   Common:
    GLOBAL:0
   Function sgemm_kernel_10:
    REG:188 STACK:0 SHARED:17408 LOCAL:0 CONSTANT[0]:564 TEXTURE:0 SURFACE:0 SAMPLER:0

cuobjdump --dump-resource-usage cutlass.cubin

  Resource usage:
   Common:
    GLOBAL:0
   Function cutlass_sgemm_kernel_9:
    REG:214 STACK:0 SHARED:17408 LOCAL:0 CONSTANT[0]:564 TEXTURE:0 SURFACE:0 SAMPLER:0

```

Register usage increased from `188` to `214`, a `13%` increase in register usage. However, this isn't always the case. I've seen other examples not affect register pressure and even decrease register pressure.

Below is a table of the different instructions that have changed for this kernel:

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    padx="2"
    pady="2"
    id="sass-diff-table"
    show_calculations="false"
    headers="Mnemonic,Baseline,CUTLASS,Δ"
    data="IMAD.MOV.U32,0,37,+37
    HFMA2.MMA,5,0,-5
    LEA,15,2,-13
    IMAD.SHL.U32,0,10,+10
    CS2R,75,64,-11
    MOV,8,0,-8
    IMAD,0,8,+8
    ULDC.64,4,1,-3
    FFMA,787,801,+14"
%}

# So... what is it doing?

So far, we've dug into specifics. The higher optimization seems to most likely do the following (think hardware store worker trying to get a project done):

- Instruction selection - use f32 units instead of tensor cores for zeroing registers (Use the small screwdriver for simple tasks, not the power drill)
- Instruction reordering - mix memory loads with math (Cut wood while paint dries)
- Influence register pressure - may increase the number of registers used to achieve reodering (Bigger workbench means better organization, even if more crowded)

```md
When ptxas sees matrix operations (MAD/MMA):

  Instruction selection:
    HMMA,MOV -> IMAD 

  Instruction reordering:
    LDS spread across FMMA

  As a Side effect:
    May increase register pressure
```

# When should you apply this optimization?

With kernel writing, it's tricky to say when you absolutely should and shouldn't use this optimization. The optimization seems to increase ILP at the cost of register pressure<span class="sidenote-ref"></span><span class="sidenote">Won't increase register pressure in some cases!</span>. Always benchmark to ensure the performance is good<span class="sidenote-ref"></span><span class="sidenote">I've seen the optimization not affect performance on some cards while affecting others significantly</span>.

# How to apply this to triton

```python
import torch
import triton
import triton.language as tl

def rename_kernel(proxy):
    return "cutlass_kernel"

# will convert "my_kernel" -> cutlass_kernel
@triton.jit(repr=rename_kernel)
def my_kernel(M: tl.constexpr):
    pass

# compile and extract ptx
my_kernel[(1,)](M=32)
dev = torch.cuda.current_device()
kernel_cache = my_kernel.device_caches[dev][0]
compiled = next(iter(kernel_cache.values()))
ptx = compiled.asm["ptx"]

# print the kernel name from PTX
print('\n'.join(ptx.splitlines()[:20]))

```

It will show

```c
//
// Generated by LLVM NVPTX Back-End
//

.version 8.7
.target sm_86
.address_size 64

        // .globl       cutlass_kernel          // -- Begin function cutlass_kernel
                                        // @cutlass_kernel
.visible .entry cutlass_kernel(
        .param .u64 .ptr .global .align 1 cutlass_kernel_param_0,
        .param .u64 .ptr .global .align 1 cutlass_kernel_param_1
)
```

# How to apply this to ptxas

A universal patch to ptxas (which most frameworks invoke) is to just replace `cutlass` in the binary with something else.

Here's how I do it:

```python
input_path  = "/usr/local/cuda/bin/ptxas"
output_path = "ptxas_no_cutlass"

with open(input_path, "rb") as f:
    blob = bytearray(f.read())

# We expect exactly "cutlass" inside ptxas.
target = b"cutlass"
off = blob.find(target)
assert off != -1, "ptxas did not contain the cutlass marker!"

# Overwrite: c u t l a s s  →  ff ff ff ff ff ff ff, so that strstr("0xFF") since kernel names contains ascii
for i in range(len(target)):
    blob[off + i] = 0xFF

with open(output_path, "wb") as f:
    f.write(blob)

print(f"patched '{target.decode()}' at offset {off:#x}")
```

# Resolving Public Statements

In my opinion, there seems to be a lot of assumptions people are throwing out on the internet about this optimization. I want to clear some of that up.

On the top of the [hackernews post](https://news.ycombinator.com/item?id=45458948), it links to a response from a user about this optimization.

{% include image.html path="/assets/images/posts/2025-12-05/unstable.png" width="100%" url_source="https://github.com/triton-lang/triton/pull/7298" url_text="Github pull" %}

This statement is incorrect; I have compiled many real world projects with this optimization on and off and they ran without failing (passing output asserts) on different cards.

Also with [a highly voted reddit comment](https://www.reddit.com/r/programming/comments/1nx3g70/fp8_runs_100_tflops_faster_when_the_kernel_name/)

{% include image.html path="/assets/images/posts/2025-12-05/reddit.png" width="100%" url_source="https://www.reddit.com/r/programming/comments/1nx3g70/fp8_runs_100_tflops_faster_when_the_kernel_name/" url_text="Reddit - Fp8 runs ~100 tflops faster when the kernel name has 'cutlass' in it" %}

This explanation is really hard to understand. I'm guessing that the user is stating this trick uses NaNs/zeroes to optimize the program. It doesn't use that. In fact, it tries to optimizes how registers are zeroed.

# Previous mentions

This was also mentioned before by [grynet on the nvidia forums](https://forums.developer.nvidia.com/t/how-does-bar-sync-defer-blocking-get-generated/245747) where he complained that the following kernel would generate different sass

```cpp
__global__ void mykernel(float *lhs, float *rhs, float *res, int M, int N, int K) {
   cutlass::gemm::GemmCoord problem_size(M,N,K);
   compute_gemm_with_cutlass(lhs, rhs, res, problem_size);
}
```

```cpp
__global__ void mykernel(float *lhs, float *rhs, float *res, int M, int N, int K, cutlass::gemm::GemmCoord dummy) {
   cutlass::gemm::GemmCoord problem_size(M,N,K);
   compute_gemm_with_cutlass(lhs, rhs, res, problem_size);
}
```

and `BAR.SYNC.DEFER_BLOCKING` would be generated here instead of `BAR.SYNC` (due to cutlass being added as part ofthe function signature)

Perhaps this was also a part of the optimization in previous versions of `ptxas`?

# Takeaway

Adding "cutlass" to your kernel name can give you 100+ TFLOPs or -20% FLOPS. Sounds quite odd, but here we are.

The real issue is that `ptxas` is a black box. You pass `-O3` and cross your fingers unlike LLVM or GCC where you get tons of flags to tweak optimization passes.

With this optimization? It helps some kernels, hurts others or not change much at all. Completely depends on your architecture and your specific code. What flies on an H100 might tank on a 5090 or B200, and you have no way to know until you run it.

So what do you do? Benchmark it. Toggle flags, try reorder the PTX, check the SASS output. That's the only way to know what `ptxas` actually did.

And this isn't going away. `tileiras` (the new TileIIR compiler) is also a black box. We may expect similar surprises like this moving forward.

# Appendix

## NVIDIA toolchain background

{% include image.html path="/assets/images/posts/2025-12-05/gpu_compilation.svg" width="100%" text="High level compilation overview for NVIDIA GPUs" %}

NVIDIA’s toolchain works like this: `CUDA code` is compiled by *nvcc* into `PTX`, an intermediate representation. Then *ptxas* takes that `PTX` and turns it into `SASS`, the low-level instruction set the GPU runs<span class="sidenote-ref"></span><span class="sidenote">ptxas and sass are both undocumented, so it may be a bit difficult to understand what's going on</span>.

## H100 SM Diagram

{% include image.html path="/assets/images/posts/2025-12-05/gh100.png" width="50%" text="H100 SM Diagram" url_source="https://resources.nvidia.com/en-us-hopper-architecture/nvidia-h100-tensor-c" url_text="NVIDIA H100 GPU Whitepaper" %}

# Citation

To cite this article:

```
@article{zhu2025cutlass,
  title = {Maybe consider putting "cutlass" in your CUDA/Triton kernels},
  author = {Zhu, Henry},
  journal = {maknee.github.io},
  year = {2025},
  month = {December},
  url = "https://maknee.github.io/blog/2025/Maybe-Consider-Putting-Cutlass-In-Your-CUDA-Kernels/"
}
```
