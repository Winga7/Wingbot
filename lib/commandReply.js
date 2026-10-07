function isInteraction(ctx) {
  return !!(ctx && typeof ctx.isRepliable === "function");
}

/**
 * Répond à une interaction (y compris déjà defer) ou à un message préfixe.
 * `ephemeral` n’est valide que sur une interaction : le passer à Message#reply
 * peut faire échouer l’envoi.
 */
async function replyCommand(ctx, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  if (!isInteraction(ctx)) {
    delete body.ephemeral;
    delete body.flags;
    return ctx.reply(body);
  }
  if (ctx.deferred || ctx.replied) {
    delete body.ephemeral;
    delete body.flags;
    return ctx.editReply(body);
  }
  return ctx.reply(body);
}

module.exports = { isInteraction, replyCommand };
