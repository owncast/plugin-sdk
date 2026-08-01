# Rules

Rules adds a **Rules** tab beside the built-in viewer tabs. It gives viewers a clear, polished list of the expectations for participating in your community.

## Install

In the Owncast admin, open **Plugins**, select **Upload plugin**, choose `rules-tab.ocpkg`, approve the requested permissions, and enable **Rules**.

## Add or edit rules

1. In the Owncast admin, open **Plugins** and select **Rules**.
2. Open the **Rules** page in the plugin navigation.
3. Edit the viewer tab name, title, description, or footer.
4. Add, edit, remove, or reorder rules with the **Up** and **Down** buttons.
5. Optionally enable **Require viewers to accept these rules**, then select **Save changes**.

The viewer tab name is plain text and can contain up to 24 characters. The title uses inline Markdown. Descriptions, footers, and rules support headings, emphasis, links, lists, quotes, and code. Raw HTML is displayed as text.

Changes publish immediately to the viewer-facing tab. Add as many rules as your community needs, with up to 1,000 characters per rule. The viewer tab stays hidden until at least one rule is published.

An **Unsaved changes** badge appears next to the save button whenever the editor differs from what viewers currently see. The viewer tab shows the date when its visible content last changed.

## Viewer acceptance

When acceptance is enabled, viewers see the rules in a blocking dialog before using the page. Selecting **I accept these rules** remembers the current rules in that browser. Changing the title, description, footer, or rules asks viewers to accept the updated version.

This is a viewer-interface prompt, not server authentication. It does not block direct video or API access, and clearing browser storage causes the prompt to appear again.

## Chat command

Any chatter can enter `!rules` to post the current numbered rules in chat. Long lists are shortened with a pointer to the viewer tab. The command has a 10-second per-user cooldown.

## Permissions

- **Modify viewer UI** adds the viewer tab, applies its custom name, and shows the optional acceptance dialog.
- **Serve HTTP** provides the authenticated admin editor.
- **Key-value storage** saves the rules and settings on this Owncast server.
- **Send chat messages** lets `!rules` post the rules under the plugin's bot identity.
