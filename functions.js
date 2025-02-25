const { db } = require(".");
const crypto = require('crypto');
const config = require('./config')

// In-memory caching with optional TTL
const localCache = new Map();
exports.cache = async (key, fetchFunction, ttl = 60000) => {
  const now = Date.now();
  const cached = localCache.get(key);
  if (cached && (!cached.expiry || cached.expiry > now)) {
    return cached.value;
  }
  localCache.delete(key);
  const data = await fetchFunction();
  localCache.set(key, { value: data, expiry: ttl > 0 ? now + ttl : null });
  return data;
};

exports.paginate = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const res = [];
  res.push([arr[0]]);
  for (let i = 1; i < arr.length; i += 2) {
    res.push(arr.slice(i, i + 2));
  }
  return res;
};


// Telegram Bot Admin Status Check
async function getAdminStatus(ctx, channelId, userId) {
  try {
    const member = await ctx.telegram.getChatMember(channelId, userId);
    return { isAdmin: ['administrator', 'creator'].includes(member.status), rights: member };
  } catch (error) {
    return { isAdmin: false, rights: null };
  }
}
exports.isBotAdminInChannel = async (ctx, channelId) => {
  const botInfo = await ctx.telegram.getMe();
  return getAdminStatus(ctx, channelId, botInfo.id);
};

exports.isUserAdminInChannel = (ctx, channelId, userId) => getAdminStatus(ctx, channelId, userId);

// Helper function to get the combined set of admin IDs
exports.getCombinedAdmins = async () => {
  try {
    const adminData = await db
      .collection('admin')
      .findOne({ admin: 1 }, { projection: { admins: 1 } });

    const dbAdmins = Array.isArray(adminData?.admins)
      ? adminData.admins
      : (typeof adminData?.admins === 'string' ? adminData.admins.split(',') : []);

    return new Set([...config.admins.map(String), ...dbAdmins.map(String)]);
  } catch (error) {
    console.error("Error in getCombinedAdmins:", error);
    return new Set();
  }
};

exports.escapeHtml = (str = "") => {
  return str.replace(/[<>"'&]/g, (m) => {
    switch (m) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return m;
    }
  });
};

// URL Validation

exports.isValidUrl = (str) => {
  try {
    const url = new URL(str);
    // Ensure the URL is http or https
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
