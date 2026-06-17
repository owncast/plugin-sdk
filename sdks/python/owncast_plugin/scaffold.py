"""`owncast-plugin-py new <slug>` scaffolder.

The Python peer of the JS `create-owncast-plugin`. Copies the bundled template
tree, substitutes the slug + a humanized display name into the files, and prints
next-step instructions. Non-interactive: takes the slug as an argument.
"""
import os
import re
import sys

TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template")

# Same rule as the JS scaffolder and the host: lowercase letters, digits, or
# hyphens, must start with a letter, max 64 chars.
_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


def humanize(slug):
    """"my-cool-bot" -> "My Cool Bot" as a starting display name."""
    return " ".join(part[:1].upper() + part[1:] for part in slug.split("-") if part)


def _render(text, slug, display_name):
    return (
        text.replace("__PLUGIN_SLUG__", slug)
        .replace("__PLUGIN_DISPLAY_NAME__", display_name)
    )


def _copy_tree(src, dst, slug, display_name):
    if os.path.isdir(src):
        os.makedirs(dst, exist_ok=True)
        for entry in os.listdir(src):
            _copy_tree(
                os.path.join(src, entry), os.path.join(dst, entry), slug, display_name
            )
    else:
        with open(src, "r", encoding="utf-8") as f:
            content = f.read()
        with open(dst, "w", encoding="utf-8") as f:
            f.write(_render(content, slug, display_name))


def create(target):
    dest = os.path.abspath(target)
    if os.path.exists(dest):
        sys.exit("error: %s already exists" % dest)

    slug = os.path.basename(dest.rstrip(os.sep))
    if not _SLUG_RE.match(slug):
        sys.exit(
            "error: %s is not a valid plugin slug.\n"
            "Slugs must be lowercase letters, digits, or hyphens, start with a "
            'letter, max 64 chars (e.g. "my-cool-bot").' % slug
        )

    display_name = humanize(slug)
    _copy_tree(TEMPLATE_DIR, dest, slug, display_name)

    print("Created %s" % dest)
    print("")
    print("Plugin slug: %s" % slug)
    print("Display name: %s (edit plugin.manifest.json to change)" % display_name)
    print("")
    print("Next steps:")
    print("  cd %s" % target)
    print("  owncast-plugin-py test")
    print("  owncast-plugin-py package")
    return slug
