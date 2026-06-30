from owncast_plugin import plugin, owncast, filter


# Greet anyone whose message starts with "hi". This handler is the one
# __tests__/plugin.test.json asserts on, so you have a working end-to-end
# example to extend from.
@plugin.on_chat_message
def greet(msg):
    words = msg.body.split()
    if words and words[0].lower() == "hi":
        # msg.user is a User (id, display_name, display_color, scopes), or None for the
        # rare message with no associated account.
        name = msg.user.display_name if msg.user else "there"
        owncast.chat.send(f"hello, {name}!")


# Other handlers you can define (subscriptions are derived automatically from
# which handlers you register; permissions still go in the manifest):
#
#   @plugin.filter_chat_message
#   def moderate(msg):
#       return filter.pass_()  # or filter.modify(...) / filter.drop("reason")
#
#   @plugin.on_chat_user_joined
#   def welcome(user): ...
#
#   @plugin.on_stream_started
#   def live(info): ...
#
#   @plugin.on("your.custom.event")
#   def handle(payload): ...
#
#   @plugin.get("/api/hello")
#   def hello(req):
#       return {"status": 200, "body": "hi"}
