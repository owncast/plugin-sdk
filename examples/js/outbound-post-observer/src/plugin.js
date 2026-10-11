const { definePlugin, owncast } = require("@owncast/plugin-sdk");

const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function hasPublicRecipient(value) {
  return Array.isArray(value) ? value.includes(PUBLIC) : value === PUBLIC;
}

function hasPublicAudience(activity, object) {
  const activityHasAudience =
    activity.to !== undefined || activity.cc !== undefined;
  const objectHasAudience = object.to !== undefined || object.cc !== undefined;
  return (
    (activityHasAudience || objectHasAudience) &&
    (!activityHasAudience ||
      hasPublicRecipient(activity.to) ||
      hasPublicRecipient(activity.cc)) &&
    (!objectHasAudience ||
      hasPublicRecipient(object.to) ||
      hasPublicRecipient(object.cc))
  );
}

module.exports = definePlugin({
  onFediverseOutbound(activity) {
    if (!activity || activity.type !== "Create") return;
    const object = activity.object;
    if (
      !object ||
      typeof object !== "object" ||
      Array.isArray(object) ||
      object.type !== "Note"
    ) {
      return;
    }
    if (!hasPublicAudience(activity, object)) return;
    owncast.chat.send("Observed a public Fediverse post.");
  },
});
