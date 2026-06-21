# A minimal Mustache-subset renderer. The JS version of this example uses the
# `mustache` npm package. This Python port keeps its own small renderer here and
# imports it from plugin.py.
#
# Supports the features the two templates use: {{var}} (HTML-escaped),
# {{{var}}}/{{&var}} (unescaped), dotted paths, {{#section}}/{{/section}}
# (truthy / list iteration), {{^inverted}}/{{/inverted}}, and {{.}} (current
# item). Produces the same HTML the JS Mustache.render() produces.
import re

__all__ = ["render"]


def _escape(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _lookup(context_stack, key):
    """Resolve a (possibly dotted) key against the context stack."""
    if key == ".":
        return context_stack[-1]
    parts = key.split(".")
    # Find the nearest context frame that has the first segment.
    for ctx in reversed(context_stack):
        if isinstance(ctx, dict) and parts[0] in ctx:
            value = ctx[parts[0]]
            for p in parts[1:]:
                if isinstance(value, dict) and p in value:
                    value = value[p]
                else:
                    return None
            return value
    return None


def _truthy(value):
    if value is None or value is False:
        return False
    if value == "":
        return False
    if isinstance(value, (list, tuple)) and len(value) == 0:
        return False
    return True


_TOKEN = re.compile(r"\{\{([#^/&]?)\s*([^}]*?)\s*\}\}")


def render(template, context):
    tokens = []
    pos = 0
    for m in _TOKEN.finditer(template):
        if m.start() > pos:
            tokens.append(("text", template[pos:m.start()]))
        sigil, key = m.group(1), m.group(2)
        if sigil == "#":
            tokens.append(("section", key))
        elif sigil == "^":
            tokens.append(("inverted", key))
        elif sigil == "/":
            tokens.append(("end", key))
        elif sigil == "&":
            tokens.append(("unescaped", key))
        else:
            tokens.append(("var", key))
        pos = m.end()
    if pos < len(template):
        tokens.append(("text", template[pos:]))
    out, _ = _render_tokens(tokens, 0, [context])
    return out


def _render_tokens(tokens, i, stack):
    out = []
    while i < len(tokens):
        kind, val = tokens[i]
        if kind == "text":
            out.append(val)
            i += 1
        elif kind == "var":
            out.append(_escape(_lookup(stack, val) if _lookup(stack, val) is not None else ""))
            i += 1
        elif kind == "unescaped":
            v = _lookup(stack, val)
            out.append("" if v is None else str(v))
            i += 1
        elif kind == "section":
            inner, i = _collect_section(tokens, i + 1, val)
            value = _lookup(stack, val)
            if _truthy(value):
                if isinstance(value, (list, tuple)):
                    for item in value:
                        rendered, _ = _render_tokens(inner, 0, stack + [item])
                        out.append(rendered)
                else:
                    frame = value if isinstance(value, dict) else {}
                    rendered, _ = _render_tokens(inner, 0, stack + [frame])
                    out.append(rendered)
        elif kind == "inverted":
            inner, i = _collect_section(tokens, i + 1, val)
            if not _truthy(_lookup(stack, val)):
                rendered, _ = _render_tokens(inner, 0, stack)
                out.append(rendered)
        elif kind == "end":
            return "".join(out), i + 1
        else:
            i += 1
    return "".join(out), i


def _collect_section(tokens, i, name):
    """Return (inner_tokens, index_after_matching_end) for a section."""
    inner = []
    depth = 0
    while i < len(tokens):
        kind, val = tokens[i]
        if kind in ("section", "inverted"):
            depth += 1
            inner.append(tokens[i])
        elif kind == "end":
            if depth == 0:
                return inner, i + 1
            depth -= 1
            inner.append(tokens[i])
        else:
            inner.append(tokens[i])
        i += 1
    return inner, i
