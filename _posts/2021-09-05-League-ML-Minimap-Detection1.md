---
layout: post
title: Machine Learning with League of Legends - Minimap Detection (Part 1)
date: 2021-09-05 04:00:00
summary: Detecting League of Legends icons on the minimap
categories: Opengl
thumbnail: "/assets/images/posts/2021-09-05/icon.jpg"
comments: true
tags:
  - Machine Learning
---

{% include image.html path="/assets/images/posts/2021-09-05/icon.jpg" width="100%" %}

## Links to series

- [Introduction]({{ site.baseurl }}{% link _posts/2020-03-18-League-ML-Intro.md %})
- [Minimap Detection]({{ site.baseurl }}{% link _posts/2021-09-05-League-ML-Minimap-Detection1.md %})
- [Minimap Detection v2]({{ site.baseurl }}{% link _posts/2021-09-06-League-ML-Minimap-Detection2.md %})

### Updates

- <span style="color:DeepSkyBlue">**This was made back in March 2020 right as COVID hit. After over a year of forgetting to upload this post, I finally uploaded.**</span>

## Abstract

The minimap is an important feature in the popular online MOBA, League of Legends. Automatic detection of champions icons on the minimap can provide additional information.

## Introduction

The minimap in League of Legends is a global view of the state of the game contained in a top down 2D view of the map. The minimap contains information such as the position of the ally champions, positions of enemy champions (if they are visible), visibility covered by wards, what towers and inhibitors are up, etc...

The minimap is an extremely important tool that a player can view to gain more information about the current state of the game.

{% include image.html path="/assets/images/posts/2021-09-05/minimap.png" width="100%" text="League of Legends minimap"%}

Champions also appear on the minimap (visually with the champion image as an icon). Detecting champion on the minimap can produce useful information -- aiding in helping players visually see enemy champions appear, tracking the movements of professional players, etc. Let's tackle this problem!

## Why not use classical computer vision algorithms?

Detection of champion seems simple enough for an attempt to use classical computer vision algorithms/techniques.

A system that could detect champions on the minimap fairly well was built using [OpenCV Library](https://opencv.org/) (one of the most popular open-source computer vision library).

So, I attempted to make a detection system using opencv.

[The source is here](https://github.com/Maknee/LeagueMinimapDetectionOpenCV)

The detection is split into two parts; the top image detects champions on the red side and the bottom image detects champions on the blue side.

{% include image.html path="/assets/images/posts/2021-09-05/opencv_result.gif" width="50%" text="OpenCV results"%}

An high level overview of detection is presented in the following pipeline image:

{% include image.html path="/assets/images/posts/2021-09-05/opencv_demo.gif" width="100%" text="OpenCV pipeline"%}

The first step of the pipeline is to use [cv2.inRange](https://docs.opencv.org/3.4/da/d97/tutorial_threshold_inRange.html) to filter out colors belonging to the circle border belonging to champion icons in order to focus on parts of the minimap that could possibly contain a champion.

{% highlight python %}

def filter_red(self, minimap):
lower_red = np.array([100, 20, 20])
upper_red = np.array([255, 100, 100])

    # filter only colors in the minimap between lower_red and upper_red
    img = cv2.inRange(minimap, lower_red, upper_red)

    return img

{% endhighlight %}

{% include image.html path="/assets/images/posts/2021-09-05/opencv_filter.gif" width="100%" text="Filter the color from the minimap"%}

The next step is to use [cv2.findContours](https://opencv-python-tutroals.readthedocs.io/en/latest/py_tutorials/py_imgproc/py_contours/py_contours_begin/py_contours_begin.html) to find a curve joining continous points (basically any line of points that are connected). The boundaries of the contours are computed with [cv2.minEnclosingCircle](https://docs.opencv.org/3.4/dd/d49/tutorial_py_contour_features.html) and they are checked to ensure that they are at least the size of a champion icon.

{% highlight python %}

def find_champions(self, ..., color_filtered_minimap):
contours, hierarchy = cv2.findContours(
color_filtered_minimap, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
for c in contours: # find circle enclosing the contour
(x, y), r = cv2.minEnclosingCircle(c)
...

        # some checks to make sure the
        # circle size is big enough to be a champion icon
        if r > 12 and r < 40 and x >= 0 and
            x + w < width and y >= 0 and y + h < height:
            ...

{% endhighlight %}

{% include image.html path="/assets/images/posts/2021-09-05/opencv_contours.gif" width="100%" text="Find contours and verify if the contours' size"%}

Lastly, [cv2.matchTemplate](https://opencv-python-tutroals.readthedocs.io/en/latest/py_tutorials/py_imgproc/py_template_matching/py_template_matching.html) is used to find the location of champion icons in the regions found using contours. A threshold is used to ensure that enough of the image matches the champion.

{% highlight python %}

def find_champions(self, ..., color_filtered_minimap):
...
for champion, icon in icons: # match the template of the champion with the contour
res = cv2.matchTemplate(contour, icon, cv2.TM_CCOEFF_NORMED)

        # check that the result meets a threshold
        loc = np.where(res >= self.threshold)
        ...

{% endhighlight %}

{% include image.html path="/assets/images/posts/2021-09-05/opencv_detection.gif" width="100%" text="Matching template with contours"%}

### Pitfalls

As one may notice, the system is not perfect; champions are not detected frequently as one would expect and there are sometimes false positive labels.

Some examples include:

{% include image.html path="/assets/images/posts/2021-09-05/opencv_overlay.gif" width="50%" text="The overlay of the white box affects detection; the system incorrectly labels Janna as Jayce or does not detect Janna"%}

{% include image.html path="/assets/images/posts/2021-09-05/opencv_overlay2.gif" width="50%" text="Another example of the effects with overlay; Fizz is not detected for a duration when the ping is active"%}

{% include image.html path="/assets/images/posts/2021-09-05/opencv_overlay3.png" width="50%" text="False negative; a seemingly random spot is detected as Caitlyn"%}

### Conclusion, future work and moving forward

In the perfect scenario, where there are no overlaying objects (even other champions can overlay another champion partially or fully), the system can still fail to detect certain champions or miscategorize seemingly random parts of the minimap as another champion.

The miscategorization is affected by the threshold. I have not found a perfect threshold to balance finding champions and generating miscategorizations.

Future work include using [ORB](https://opencv-python-tutroals.readthedocs.io/en/latest/py_tutorials/py_feature2d/py_orb/py_orb.html) or [SIFT](https://docs.opencv.org/trunk/da/df5/tutorial_py_sift_intro.html) to extract keypoints and find features that match the champion icons, which may improve image detection significantly.

Now that we have an idea of what problems there are, the next [post]({{ site.baseurl }}{% link _posts/2021-09-06-League-ML-Minimap-Detection2.md %}) discusses an improved approach in detail.
