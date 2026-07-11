# Engagement Bot

Connects Owncast events to your outside channels: it pings Discord and posts to the fediverse when you go live, browser-pushes on new fediverse followers, forwards likes, reposts, quotes, mentions, replies, and raw inbound activities to Discord, and quietly removes obvious chat spam.

## Setup

This plugin uses integrations you've **already configured in Owncast**, and adds no settings of its own:

- **Discord** and **browser-push** notifications use your server's configured notification channels (**Admin → Notifications**). If those aren't set up, those messages have nowhere to go.
- **Fediverse** posting uses your server's fediverse / ActivityPub account. Federation must be enabled (**Admin → Social / Federation**).

Then enable the plugin in **Admin → Plugins**.

## What it does

- **Stream start** → posts "Stream live: \<title\>" to Discord and "🔴 Going live: \<title\>" to the fediverse.
- **New fediverse follower** → sends a browser-push notification to subscribed viewers.
- **Fediverse activity** → forwards likes, reposts, quotes, mentions, replies, and raw verified activities to Discord.
- **Chat spam** → automatically deletes messages containing obvious spam phrases (e.g. "free money", "click here").

## Permissions

- **notifications.send**: Discord messages and browser-push notifications.
- **fediverse.inbound**: receiving all seven inbound event subscriptions, including raw verified activities and the six specialized handlers.
- **fediverse.post**: the go-live fediverse announcement.
- **chat.moderate**: deleting spam messages from chat.
