# Manual Video Settings

A hand-edit form for the Owncast transcoding pipeline. Use it when you want to tune output settings directly without going through the standard preset UI. It's useful for one-off experiments or hardware that needs a non-default codec.

## What this plugin lets you change

Opening **Manual Video Settings** under the admin sidebar shows a single form with:

- **Latency level**: `0` (lowest) through `4` (highest). Lower means viewers see the stream sooner but rebuffer more on flaky networks.
- **Codec**: the FFmpeg encoder Owncast invokes (`libx264` software, plus `h264_vaapi`, `h264_nvenc`, `h264_qsv`, `h264_omx`, `h264_v4l2m2m`, and `h264_videotoolbox`). Hardware encoders must be available in the host's ffmpeg build.
- **Autoplay**: `off`, `always`, or `sound-only`.
- **Output variants**: one row per HLS rendition, with editable **width**, **height**, **FPS**, **video kbps**, **CPU usage**, and a **passthrough** checkbox. Add or remove rows from the form.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Open **Manual Video Settings** in the sidebar.
3. Edit fields, then click **Save**. The status line confirms `Saved.` or shows the host's error message if a setting was rejected.
4. **Reload** discards in-form edits and re-fetches the live config.

Changes apply when the next stream starts. The host does not restart an active broadcast.

## Safety notes

- This bypasses the preset UI's guardrails. It's possible to pick a codec your hardware doesn't support, in which case Owncast will fail to start the encoder when you next go live. If that happens, re-enable a standard preset from the regular video settings page and the plugin will read the new state on next load.
- Bitrate / resolution combinations that exceed your CPU/GPU's encode budget can cause dropped frames. Watch the server logs after a save if you're pushing the hardware.
- The admin form is gated by your normal Owncast admin login. An unauthenticated viewer cannot read or write the config.

## Permissions

```json
{
  "permissions": ["http.serve", "videoconfig.read", "videoconfig.write"]
}
```

`videoconfig.write` is the privileged half. It lets the plugin change live transcoding state, so grant it deliberately.
