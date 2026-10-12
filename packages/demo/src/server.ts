import express from 'express';
import { apidock, createRouter, serveSpec, type Handlers } from 'apidock/express';
import { FileStorage, StorageReporter } from 'apidock/server';
import type { z } from 'zod';
import { api, type Post, type User } from './contract.js';

type UserT = z.output<typeof User>;
type PostT = z.output<typeof Post>;

const users = new Map<string, UserT>();
const posts = new Map<string, PostT>();
let seq = 0;
const id = (prefix: string) => `${prefix}_${++seq}`;

for (const [name, email, role] of [
  ['Ada Lovelace', 'ada@example.com', 'admin'],
  ['Grace Hopper', 'grace@example.com', 'member'],
  ['Linus Torvalds', 'linus@example.com', 'member'],
] as const) {
  const user: UserT = { id: id('u'), name, email, role, createdAt: new Date().toISOString() };
  users.set(user.id, user);
}
const first = [...users.values()][0]!;
for (const [title, status] of [['Notes on the Analytical Engine', 'published'], ['Untitled draft', 'draft']] as const) {
  const post: PostT = { id: id('p'), authorId: first.id, title, body: 'Lorem ipsum.', status };
  posts.set(post.id, post);
}

const notFound = (what: string) => ({ status: 404 as const, body: { error: `${what} not found` } });

const handlers: Handlers<typeof api.routes> = {
  listUsers: ({ query }) => {
    const all = [...users.values()].filter((u) => !query.role || u.role === query.role);
    return { status: 200, body: { items: all.slice(query.offset, query.offset + query.limit), total: all.length } };
  },
  getUser: ({ params }) => {
    const user = users.get(params.id);
    return user ? { status: 200, body: user } : notFound(`User ${params.id}`);
  },
  createUser: ({ headers, body }) => {
    if (headers.authorization !== 'Bearer demo-admin') return { status: 401, body: { error: 'Admin token required' } };
    if ([...users.values()].some((u) => u.email === body.email)) return { status: 409, body: { error: `${body.email} is already in use` } };
    const user: UserT = { id: id('u'), ...body, createdAt: new Date().toISOString() };
    users.set(user.id, user);
    return { status: 201, body: user };
  },
  deleteUser: ({ params }) => (users.delete(params.id) ? { status: 204 } : notFound(`User ${params.id}`)),
  listPosts: ({ params, query }) => {
    if (!users.has(params.id)) return notFound(`User ${params.id}`);
    const all = [...posts.values()].filter((p) => p.authorId === params.id && (!query.status || p.status === query.status));
    return { status: 200, body: { items: all.slice(query.offset, query.offset + query.limit), total: all.length } };
  },
  createPost: ({ params, body }) => {
    if (!users.has(params.id)) return notFound(`User ${params.id}`);
    const post: PostT = { id: id('p'), authorId: params.id, ...body };
    posts.set(post.id, post);
    return { status: 201, body: post };
  },
  publishPost: ({ params, body }) => {
    const post = posts.get(params.postId);
    if (!post) return notFound(`Post ${params.postId}`);
    const next = { ...post, ...body };
    posts.set(next.id, next);
    return { status: 200, body: next };
  },
};

const storage = new FileStorage('.apidock');
const app = express();
app.use('/api', createRouter(api, handlers, { validateResponses: 'warn', report: new StorageReporter(storage) }));
app.get('/openapi.json', serveSpec(api));
app.use('/apidock', apidock({ api, storage }));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Demo API      http://localhost:${port}/api/users`);
  console.log(`OpenAPI spec  http://localhost:${port}/openapi.json`);
  console.log(`ApiDock       http://localhost:${port}/apidock/`);
});
