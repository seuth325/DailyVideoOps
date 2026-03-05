const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const { loadDb, withDb } = require('./lib/store');
const { ALLOWED_PLATFORMS, runPost, startScheduler } = require('./lib/postingEngine');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
  })
);

function setFlash(req, message) {
  req.session.flash = message;
}

function popFlash(req) {
  const msg = req.session.flash;
  delete req.session.flash;
  return msg;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  return next();
}

function currentUser(req) {
  if (!req.session.userId) return null;
  const db = loadDb();
  return db.users.find((u) => u.id === req.session.userId) || null;
}

app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

app.get('/signup', (req, res) => {
  res.render('signup', { flash: popFlash(req) });
});

app.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    setFlash(req, 'Name, email, and password are required.');
    return res.redirect('/signup');
  }

  const db = loadDb();
  const existing = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    setFlash(req, 'Email already exists. Log in instead.');
    return res.redirect('/login');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  withDb((mutableDb) => {
    mutableDb.users.push({
      id: uuidv4(),
      email: email.toLowerCase(),
      name,
      passwordHash,
      createdAt: new Date().toISOString(),
    });
  });

  setFlash(req, 'Account created. Please log in.');
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { flash: popFlash(req) });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    setFlash(req, 'Email and password are required.');
    return res.redirect('/login');
  }

  const db = loadDb();
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    setFlash(req, 'Invalid email or password.');
    return res.redirect('/login');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    setFlash(req, 'Invalid email or password.');
    return res.redirect('/login');
  }

  req.session.userId = user.id;
  return res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  const user = currentUser(req);
  const db = loadDb();

  const posts = db.posts
    .filter((p) => p.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const logs = db.postLogs
    .filter((l) => l.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);

  res.render('dashboard', {
    flash: popFlash(req),
    user,
    posts,
    logs,
    platforms: ALLOWED_PLATFORMS,
    nowIsoLocal: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  });
});

app.post('/posts', requireAuth, (req, res) => {
  const user = currentUser(req);
  const { title, caption, scheduledAt } = req.body;
  const selected = Array.isArray(req.body.platforms)
    ? req.body.platforms
    : req.body.platforms
      ? [req.body.platforms]
      : [];

  if (!title || !caption) {
    setFlash(req, 'Title and caption are required.');
    return res.redirect('/dashboard');
  }

  const validPlatforms = selected.filter((p) => ALLOWED_PLATFORMS.includes(p));
  if (validPlatforms.length === 0) {
    setFlash(req, 'Select at least one platform.');
    return res.redirect('/dashboard');
  }

  let status = 'draft';
  let scheduledAtIso = null;

  if (scheduledAt) {
    const dt = new Date(scheduledAt);
    if (Number.isNaN(dt.getTime())) {
      setFlash(req, 'Invalid schedule date/time.');
      return res.redirect('/dashboard');
    }
    status = 'scheduled';
    scheduledAtIso = dt.toISOString();
  }

  withDb((db) => {
    db.posts.push({
      id: uuidv4(),
      userId: user.id,
      title,
      caption,
      platforms: validPlatforms,
      status,
      scheduledAt: scheduledAtIso,
      postedAt: null,
      createdAt: new Date().toISOString(),
    });
  });

  setFlash(req, 'Post created successfully.');
  return res.redirect('/dashboard');
});

app.post('/posts/:id/run', requireAuth, (req, res) => {
  const user = currentUser(req);
  const postId = req.params.id;

  const db = loadDb();
  const post = db.posts.find((p) => p.id === postId && p.userId === user.id);
  if (!post) {
    setFlash(req, 'Post not found.');
    return res.redirect('/dashboard');
  }

  const result = runPost(postId, user.email);
  if (!result.ok) {
    setFlash(req, result.reason);
  } else {
    setFlash(req, 'Post ran successfully (simulated publishing).');
  }

  return res.redirect('/dashboard');
});

app.post('/posts/:id/delete', requireAuth, (req, res) => {
  const user = currentUser(req);
  const postId = req.params.id;

  withDb((db) => {
    db.posts = db.posts.filter((p) => !(p.id === postId && p.userId === user.id));
  });

  setFlash(req, 'Post deleted.');
  return res.redirect('/dashboard');
});

startScheduler();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`DailyVideoOps web app running at http://localhost:${PORT}`);
});
