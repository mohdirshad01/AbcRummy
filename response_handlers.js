const { db } = require(".");
const bot = require("./bot");
const config = require("./config");
const { check_status, authAdmin, check_user } = require("./middlewares");
const { escapeHtml } = require("./functions");
const { get_main_menu, get_admin, get_user_settings_tab, get_social_sites, get_admin_settings } = require("./layout");


// ----- Response Handler Function -----//

let response_data = {};

exports.create_response = (ctx, target, payload = {}, back_command) => {
  response_data[ctx.from.id] = { target, payload, back_command };
};

exports.delete_response = async ctx => {
  delete response_data[ctx.from.id]
}


// ---- Cancel & Back Button Function & Handlers ---- //

exports.cancel_button = 'Cancel'
exports.back_button = 'Back'

bot.hears([this.cancel_button], check_user, check_status, async (ctx) => {
  exports.delete_response(ctx);
  ctx.replyWithHTML('action cancelled.', { reply_markup: { remove_keyboard: true } });
});

bot.action([this.back_button], authAdmin, async (ctx) => {
  await ctx.deleteMessage();
  let main_menu = get_main_menu(ctx);
  ctx.replyWithHTML('Main Menu', main_menu.markup);

});

bot.hears([this.back_button], authAdmin, async (ctx) => {
  exports.delete_response(ctx);
  let main_menu = get_main_menu(ctx);
  ctx.replyWithHTML('Main Menu', main_menu.markup);
  const adminMarkup = await get_admin(ctx);
  ctx.replyWithHTML(adminMarkup.text, adminMarkup.markup);
});


// ======== User Settings ========
bot.on('message', async (ctx, next) => {
  if (response_data[ctx.from.id]?.target !== 'admin_user_id') return next();

  if (!ctx.message?.text || typeof ctx.message.text !== 'string') return next();

  let input = ctx.message.text.trim();
  let userId = Number(input);
  if (isNaN(userId)) return await ctx.replyWithHTML('⚠️ Invalid user ID.');

  const userData = await db.collection('users').findOne({ user_id: parseInt(input) });
  if (!userData) return await ctx.replyWithHTML('⚠️ User not found in bot database.');

  this.delete_response(ctx);
  const userMarkup = await get_user_settings_tab(ctx, null, userData);
  await ctx.replyWithHTML(userMarkup.text, userMarkup.keyboard);
  await ctx.replyWithHTML(`User Settings.`, get_main_menu(ctx).markup)
});


// ======== Change User Balance ========
bot.on('message', async (ctx, next) => {
  try {
    if (response_data[ctx.from.id]?.target !== 'admin_balance_amount') return next();

    const targetUserId = response_data[ctx.from.id]?.payload?.user_id;
    if (!targetUserId) {
      this.delete_response(ctx);
      return await ctx.replyWithHTML('⚠️ Invalid user selection.', get_main_menu(ctx).markup);
    }

    const userData = await db.collection('users').findOne({ user_id: targetUserId });
    if (!userData) {
      this.delete_response(ctx);
      return await ctx.replyWithHTML('⚠️ User not found in the database.', get_main_menu(ctx).markup);
    }

    if (!ctx.message?.text) return next();
    const amount = ctx.message.text;

    if (isNaN(amount) || Math.abs(amount) > 1000000000) {
      await ctx.replyWithHTML('⚠️ Invalid amount !\n\nUse numbers between -1B and 1B');
      return;
    }

    if (isNaN(userData.balance)) {
      await db.collection('users').updateOne({ targetUserId }, { $set: { balance: 0 } });
    }

    this.delete_response(ctx);

    await db.collection('users').updateOne({ user_id: targetUserId }, { $inc: { balance: +parseFloat(amount) } }, { upsert: true });

    const newUserMarkup = await get_user_settings_tab(ctx, targetUserId);
    await ctx.replyWithHTML(
      `✅ Balance Added : ${amount >= 0 ? '+' : ''}₹${amount}\n`
      , get_main_menu(ctx).markup);

    await ctx.replyWithHTML(newUserMarkup.text, newUserMarkup.keyboard)

  } catch (error) {
    console.error('Balance Update Error:', {
      admin: ctx.from.id,
      error: error.stack,
      input: ctx.message?.text
    });

    await ctx.replyWithHTML(
      '⚠️ Failed to update balance. Contact DevOps.',
      get_main_menu(ctx).markup
    );
  }
});



// ======== Send Message To User ========
const pendingQueries = new Map();
const MAX_PENDING_QUERIES = 1;

// Generate random query ID
const generateQueryId = (length = 8) => Math.random().toString(36).substr(2, length);

bot.on('message', async (ctx, next) => {
  const userId = ctx.from.id;
  const userData = response_data[userId];
  if (!userData || userData.target !== 'support') return next();

  const query = ctx.message.text;
  const queryId = generateQueryId(10);
  const userQueries = pendingQueries.get(userId) || new Set();
  await this.delete_response(ctx);

  if (userQueries.size >= MAX_PENDING_QUERIES) {
    return ctx.replyWithHTML('<b>⚠️ Please wait for existing queries to be answered.</b>', get_main_menu(ctx).markup);
  }

  userQueries.add(queryId);
  pendingQueries.set(userId, userQueries);
  await ctx.deleteMessage();

  try {
    for (const admin of config.admins) {
      await bot.telegram.sendMessage(admin, `<b>🙎🏻‍♂️ Query <code>${queryId}</code> Received From <a href='tg://user?id=${userId}'>${ctx.from.first_name}</a> :- ${ctx.from.username ? ('@' + ctx.from.username) : ''}</b>\n\n<code>${escapeHtml(query)}</code>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'Reply', callback_data: `/reply ${userId} ${queryId}` }]] }
      });
    }
  } catch (error) {
    console.error(`Failed to send query to admin:`, error);
    return ctx.replyWithHTML('<b>⚠️ Failed to send response !</b>');
  }

  await ctx.replyWithHTML(`<b>✅ Message delivered to admins.\n\nℹ️ Query ID : <code>${queryId}</code></b>`);
  await ctx.replyWithHTML('Main Menu', get_main_menu(ctx).markup);
});

bot.on('message', async (ctx, next) => {
  const adminId = ctx.from.id;
  const adminData = response_data[adminId];
  if (!adminData || adminData.target !== 'reply_to_query') return next();

  const { user_id: userId, query_id: queryId } = adminData.payload;
  const answer = ctx.message.text;
  await ctx.deleteMessage();
  await this.delete_response(ctx);

  try {
    await bot.telegram.sendMessage(userId, `<b>📨 Important Admin Message :-</b>\n\n${escapeHtml(answer)}`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: "Send Reply", callback_data: "/help" }]] }
    });

    await ctx.replyWithHTML(`<b>✅ Message delivered to the user.</b>`, {
      reply_markup: { inline_keyboard: [[{ text: 'Send Again', callback_data: `/reply ${userId} ${queryId}` }]] }
    });

    const userQueries = pendingQueries.get(userId);
    if (userQueries) {
      userQueries.delete(queryId);
      if (userQueries.size === 0) pendingQueries.delete(userId);
    }

    await ctx.replyWithHTML('Main Menu', get_main_menu(ctx).markup);
  } catch (error) {
    console.error(`Failed to send reply to user ${userId}:`, error);
    await ctx.replyWithHTML('⚠️ Unable to send message !', get_main_menu(ctx).markup);
  }
});


// ======== Handle Task Edits & Responses ========
bot.on('message', async (ctx, next) => {
  try {
    const userResponse = response_data[ctx.from.id];
    if (!userResponse || userResponse.target !== 'admin_edit_task_name') return next();

    const taskId = response_data[ctx.from.id]?.payload?.taskId;
    const field = 'name';
    const inputText = ctx.message.text;

    this.delete_response(ctx);

    const updateData = {};
    updateData[field] = inputText;

    // Update the task in the database
    await db.collection('tasks').updateOne({ _id: taskId }, { $set: updateData });

    const updatedTask = await db.collection('tasks').findOne({ _id: taskId });
    if (!updatedTask) {
      await ctx.reply("⚠️ Task not found !");
      return;
    }

    await ctx.replyWithHTML(
      `<b>✅ ${field.charAt(0).toUpperCase() + field.slice(1)} updated.</b>\n\n`,
      {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "↩️ Go Back", callback_data: `edit_${taskId}` }]],
        },
      }
    );

  } catch (error) {
    console.error("Error in message handler:", error);
    await ctx.reply(`An error occurred while updating the task.`);
  }
});

function formatText(input) {
  return input
    .replace(/\*(.*?)\*/g, '<b>$1</b>')  // Convert *bold* to <b>bold</b>
    .replace(/_(.*?)_/g, '<i>$1</i>')    // Convert _italic_ to <i>italic</i>
    .replace(/``(.*?)``/g, '<code>$1</code>'); // Convert ``monospace`` to <code>monospace</code>
}

bot.on('message', async (ctx, next) => {
  try {
    const userResponse = response_data[ctx.from.id];
    if (!userResponse || userResponse.target !== 'admin_edit_task_message') return next();

    const taskId = response_data[ctx.from.id]?.payload?.taskId;
    const field = 'messageText';
    const inputText = ctx.message.text;

    this.delete_response(ctx);

    const updateData = {};
    updateData[field] = formatText(inputText);

    await db.collection('tasks').updateOne({ _id: taskId }, { $set: updateData });

    const updatedTask = await db.collection('tasks').findOne({ _id: taskId });
    if (!updatedTask) {
      await ctx.reply("⚠️ Task not found !");
      return;
    }

    await ctx.replyWithHTML(
      `<b>✅ ${field.charAt(0).toUpperCase() + field.slice(1)} updated.</b>\n\n`,
      {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "↩️ Go Back", callback_data: `edit_${taskId}` }]],
        },
      }
    );
  } catch (error) {
    console.error("Error in message handler:", error);
    await ctx.reply(`An error occurred while updating the task.`);
  }
});

bot.on('message', async (ctx, next) => {
  try {
    const userResponse = response_data[ctx.from.id];
    if (!userResponse || userResponse.target !== 'admin_edit_task_mediaURL') return next();

    const taskId = response_data[ctx.from.id]?.payload?.taskId;
    const field = 'mediaURL';
    const inputText = ctx.message.text;

    this.delete_response(ctx);

    const updateData = {};
    updateData[field] = inputText;

    await db.collection('tasks').updateOne({ _id: taskId }, { $set: updateData });

    const updatedTask = await db.collection('tasks').findOne({ _id: taskId });
    if (!updatedTask) {
      await ctx.reply("⚠️ Task not found !");
      return;
    }

    await ctx.replyWithHTML(
      `<b>✅ ${field.charAt(0).toUpperCase() + field.slice(1)} updated.</b>\n\n`,
      {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "↩️ Go Back", callback_data: `edit_${taskId}` }]],
        },
      }
    );

  } catch (error) {
    console.error("Error in message handler:", error);
    await ctx.reply(`An error occurred while updating the task.`);
  }
});



// ======== Add Admin ========
bot.on('message', async (ctx, next) => {
  if (response_data[ctx.from.id]?.target !== 'add_admin_id') return next();

  const answer = ctx.message.text.trim();
  this.delete_response(ctx);

  try {
    const isConfiguredAdmin = config.admins.map(String).includes(answer);
    const adminData = await db.collection('admin').findOne({ admin: 1 });
    const isDbAdmin = adminData?.admins?.includes(answer);

    if (isConfiguredAdmin || isDbAdmin) {
      return ctx.replyWithHTML(
        `⚠️ ${answer} is already ${isConfiguredAdmin ? 'a configured admin' : 'an admin'} !`,
      );
    }

    await db.collection('admin').updateOne(
      { admin: 1 },
      { $addToSet: { admins: answer } },
      { upsert: true }
    );

    const adminMarkup = await get_admin_settings(ctx);
    await ctx.replyWithHTML(`✅ ${answer} added as an admin.`, get_main_menu(ctx).markup);
    await ctx.replyWithHTML(adminMarkup.text, adminMarkup.markup);

  } catch (error) {
    console.error('Error adding admin :', error);
    await ctx.replyWithHTML('⚠️ Unable to add admin. Contact DevOps.');
  }
});


// ======== Add Channels ========
bot.on('message', async (ctx, next) => {
  if (!response_data[ctx.from.id] || response_data[ctx.from.id]?.target !== 'admin_channel_id') return next();

  if (!ctx.from) return next();

  const userId = ctx.from.id;
  const answer = ctx.message.text.trim()

  if (!/^-100\d{10}$/.test(answer)) {
    return ctx.replyWithHTML(
      "⚠️ Invalid channel ID format !\n\nUse : <code>-1001234567890</code>"
    );
  }

  try {
    const botInfo = await bot.telegram.getMe();
    const res = await bot.telegram.getChatMember(answer, botInfo.id);

    if (res.status !== "administrator" && res.status !== "creator") {
      return ctx.replyWithHTML(
        "⚠️ The bot is not an admin. Promote it."
      );
    }

    const missingPermissions = [];
    if (!res.can_change_info) missingPermissions.push("'Change Channel Info'");

    if (missingPermissions.length > 0)
      return ctx.replyWithHTML(`⚠️ The bot lacks the following admin rights :-\n\n${missingPermissions.join(", ")}.\n\nPlease add the rights and resend chat Id !`);

    await db.collection("admin").updateOne(
      { channels: 1 },
      { $push: { data: { id: answer } } },
      { upsert: true }
    );

    await ctx.replyWithHTML("✅ Channel added.", {
      reply_markup: {
        inline_keyboard: [[
          {
            text: 'Go Back',
            callback_data: '/channels_settings'
          }
        ]]
      }
    });

    await ctx.replyWithHTML('Main Menu', get_main_menu(ctx).markup)

    this.delete_response(ctx);
  } catch (err) {
    console.error("Channel setup error:", err);
    let errorMsg = "⚠️ Internal error !";
    if (err?.response?.error_code === 400) {
      errorMsg = `⚠️ Telegram API error : <code>${err.response.description}</code>`;
    } else if (err.code === 403) {
      errorMsg = "⚠️ Bot is not in this channel! ";
    }
    await ctx.replyWithHTML(errorMsg);
  }
});



// --- Social Links --- //
bot.on('message', async (ctx, next) => {
  if (
    !response_data[ctx.from.id] ||
    !(response_data[ctx.from.id]?.target == 'add_social')
  ) {
    return next();
  }

  let answer = ctx.message.text;
  let [button_text, ...urlParts] = answer.split('-');
  let url = urlParts.join('-');

  if (!button_text || !url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
    return ctx.replyWithHTML('⚠️ Please send a valid button text & url !');
  }

  await db.collection('social_sites').insertOne({ button_text, url });
  ctx.replyWithHTML(`✅ ${url} has been added to bot</b>`);
  let site_tab = await get_social_sites(ctx);
  ctx.replyWithHTML(site_tab.text, site_tab.markup).catch(err => console.log(err));
  this.delete_response(ctx);
});














