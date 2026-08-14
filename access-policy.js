const config = require('./config');

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getProfile(name) {
  return config.get(`access.profiles.${name}`) || config.get('access.profiles.blocked') || { authorized: false };
}

function getAccessPolicy(spaceId, userEmail) {
  const email = cleanEmail(userEmail);
  const spaces = config.get('access.spaces', {});
  const admins = (config.get('access.admins', []) || []).map(cleanEmail);

  if (spaceId && spaces[spaceId]?.profile) {
    return { profile: spaces[spaceId].profile, ...getProfile(spaces[spaceId].profile), userEmail: email, spaceId };
  }

  if (email && admins.includes(email)) {
    return { profile: 'admin', ...getProfile('admin'), userEmail: email, spaceId };
  }

  const defaultProfile = config.get('access.default_profile', 'user');
  return { profile: defaultProfile, ...getProfile(defaultProfile), userEmail: email, spaceId };
}

function blockedMessageFor(_message, policy) {
  if (!policy?.authorized) {
    return 'This space is not authorized. Ask an admin to enable it.';
  }
  return null;
}

function userEmailFrom(...items) {
  for (const item of items) {
    if (!item) continue;
    const email = item.email || item.emailAddress || item.user?.email || item.sender?.email;
    if (email) return cleanEmail(email);
  }
  return '';
}

module.exports = { getAccessPolicy, blockedMessageFor, userEmailFrom };
