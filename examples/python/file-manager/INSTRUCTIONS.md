# Example File Manager

A small admin tool for the files in this plugin's private storage sandbox.

## What this plugin does

- Adds a **Files** admin page.
- Lists the files in the plugin's sandbox (`data/plugin-data/file-manager/`).
- Lets you upload new files and delete existing ones.
- Lets you download any file back to your machine.

## Permissions

- `http.serve` — needed to serve the admin page and its small JSON API.
- `storage.fs` — the private, sandboxed filesystem this tool manages. Files
  stored here are server-side only and are never served over HTTP.

## Try it

Enable the plugin, open the **Files** admin page, and upload a file. It's
written into `data/plugin-data/file-manager/` on the server. Refresh the page
and you'll see it listed; download or delete it from there.
