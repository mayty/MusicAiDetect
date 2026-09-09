<!-- This file has been edited with the assistance of an AI tool. -->
# Music AI Detector

Source code for Google Chrome extension [YTM AI Artist Detector](https://chromewebstore.google.com/detail/aeemndkkpeaglfhiapkhekmnoiojodma)

Marks AI artists on YouTube Music. Clicking the extension icon opens the auto-skip
settings: pick which artist categories to skip and the extension presses Next for you
whenever a matching track starts. Auto-skip is off by default, and while it is off the popup
shows nothing but the toggle.

Turning it on reveals three collapsible sections — the categories to skip, the never-skip list
and the skip history — each showing how many entries it holds. They open one at a time, and
switching auto-skip on opens the category list for you.

The same popup lists every artist credited on a skipped track, most recent first, and lets you
move any of them to a "never skip" list. A listed artist vetoes the whole track: it plays
through even when another artist credited on it falls into a skipped category. That is why the
whole line-up is listed and not only the artist that triggered the skip — when a track you want
is skipped for one of its credits, the collaborator you list to rescue it is right there.

Artist names in both lists link to the artist's page on YouTube Music: a plain click opens it in
a new tab, while ctrl-click (Cmd-click on macOS) or a middle-click opens it in the background and
leaves the popup open, so several artists can be queued at once.
