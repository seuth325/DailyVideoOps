const cron = require('node-cron');
const { prisma } = require('./prisma');

const ALLOWED_PLATFORMS = ['facebook', 'instagram', 'whatsapp', 'youtube', 'tiktok'];

async function runPost(postId, actor = 'system') {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return { ok: false, reason: 'Post not found' };
  }

  if (post.status === 'posted') {
    return { ok: false, reason: 'Post already posted' };
  }

  const updated = await prisma.post.update({
    where: { id: postId },
    data: {
      status: 'posted',
      postedAt: new Date(),
    },
  });

  const targets = (updated.platforms || []).filter((p) => ALLOWED_PLATFORMS.includes(p));
  if (targets.length > 0) {
    await prisma.postLog.createMany({
      data: targets.map((platform) => ({
        postId: updated.id,
        userId: updated.userId,
        platform,
        message: `Simulated publish for ${platform}`,
        actor,
      })),
    });
  }

  return { ok: true, post: updated };
}

async function processDuePosts() {
  const duePosts = await prisma.post.findMany({
    where: {
      status: 'scheduled',
      scheduledAt: {
        lte: new Date(),
      },
    },
    select: { id: true },
  });

  for (const post of duePosts) {
    await runPost(post.id, 'scheduler');
  }

  return duePosts.length;
}

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    try {
      await processDuePosts();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Scheduler error:', err.message);
    }
  });
}

module.exports = {
  ALLOWED_PLATFORMS,
  runPost,
  processDuePosts,
  startScheduler,
};
