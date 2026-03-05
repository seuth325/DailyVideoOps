const cron = require('node-cron');
const { withDb } = require('./store');

const ALLOWED_PLATFORMS = ['facebook', 'instagram', 'whatsapp', 'youtube', 'tiktok'];

function runPost(postId, actor = 'system') {
  return withDb((db) => {
    const post = db.posts.find((p) => p.id === postId);
    if (!post) {
      return { ok: false, reason: 'Post not found' };
    }

    if (post.status === 'posted') {
      return { ok: false, reason: 'Post already posted' };
    }

    post.status = 'posted';
    post.postedAt = new Date().toISOString();

    const targets = (post.platforms || []).filter((p) => ALLOWED_PLATFORMS.includes(p));
    for (const platform of targets) {
      db.postLogs.push({
        id: `${post.id}_${platform}_${Date.now()}`,
        postId: post.id,
        userId: post.userId,
        platform,
        message: `Simulated publish for ${platform}`,
        createdAt: new Date().toISOString(),
        actor,
      });
    }

    return { ok: true, post };
  });
}

function processDuePosts() {
  const duePostIds = withDb((db) => {
    const now = Date.now();
    return db.posts
      .filter((p) => p.status === 'scheduled' && p.scheduledAt && new Date(p.scheduledAt).getTime() <= now)
      .map((p) => p.id);
  });

  for (const postId of duePostIds) {
    runPost(postId, 'scheduler');
  }

  return duePostIds.length;
}

function startScheduler() {
  cron.schedule('* * * * *', () => {
    processDuePosts();
  });
}

module.exports = {
  ALLOWED_PLATFORMS,
  runPost,
  processDuePosts,
  startScheduler,
};
