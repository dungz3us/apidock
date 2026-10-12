import { defineApi } from 'apidock';
import { z } from 'zod';

export const User = z
  .object({
    id: z.string().meta({ example: 'u_1' }),
    name: z.string().min(1).meta({ example: 'Ada Lovelace' }),
    email: z.email().meta({ example: 'ada@example.com' }),
    role: z.enum(['admin', 'member']).default('member'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'User', description: 'A person with access to the workspace.' });

export const NewUser = User.pick({ name: true, email: true, role: true }).meta({ id: 'NewUser' });

export const Post = z
  .object({
    id: z.string().meta({ example: 'p_1' }),
    authorId: z.string().meta({ example: 'u_1' }),
    title: z.string().min(1).max(120).meta({ example: 'Notes on the Analytical Engine' }),
    body: z.string().meta({ example: 'The engine weaves algebraic patterns…' }),
    status: z.enum(['draft', 'published']),
  })
  .meta({ id: 'Post' });

export const NewPost = Post.pick({ title: true, body: true }).extend({ status: Post.shape.status.default('draft') }).meta({ id: 'NewPost' });

export const ErrorBody = z
  .object({ error: z.string().meta({ example: 'User u_9 not found' }) })
  .meta({ id: 'Error' });

const Page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).meta({ description: 'Page size' }),
  offset: z.coerce.number().int().min(0).default(0),
});

export const api = defineApi({
  info: {
    title: 'Demo Workspace API',
    version: '1.2.0',
    description: 'A small users-and-posts API used to demonstrate ApiDock. Data lives in memory and resets on restart.',
  },
  servers: [{ url: '/api', description: 'This server' }],
  tags: [
    { name: 'users', description: 'People in the workspace.' },
    { name: 'posts', description: 'Articles written by users.' },
  ],
  securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
  routes: {
    listUsers: {
      method: 'GET',
      path: '/users',
      summary: 'List users',
      tags: ['users'],
      query: Page.extend({ role: z.enum(['admin', 'member']).optional() }),
      responses: { 200: z.object({ items: z.array(User), total: z.number().int() }) },
    },
    getUser: {
      method: 'GET',
      path: '/users/:id',
      summary: 'Get a user',
      tags: ['users'],
      params: z.object({ id: z.string().meta({ example: 'u_1' }) }),
      responses: { 200: User, 404: { schema: ErrorBody, description: 'No user with this id' } },
    },
    createUser: {
      method: 'POST',
      path: '/users',
      summary: 'Create a user',
      description: 'Requires an admin token: send `Authorization: Bearer demo-admin`.',
      tags: ['users'],
      security: [{ bearer: [] }],
      headers: z.object({ authorization: z.string().meta({ example: 'Bearer demo-admin' }) }),
      body: NewUser,
      responses: {
        201: User,
        401: { schema: ErrorBody, description: 'Missing or wrong token' },
        409: { schema: ErrorBody, description: 'Email already in use' },
      },
    },
    deleteUser: {
      method: 'DELETE',
      path: '/users/:id',
      summary: 'Delete a user',
      tags: ['users'],
      security: [{ bearer: [] }],
      responses: { 204: { description: 'Deleted' }, 404: ErrorBody },
    },
    listPosts: {
      method: 'GET',
      path: '/users/:id/posts',
      summary: "List a user's posts",
      tags: ['posts'],
      query: Page.extend({ status: z.enum(['draft', 'published']).optional() }),
      responses: { 200: z.object({ items: z.array(Post), total: z.number().int() }), 404: ErrorBody },
    },
    createPost: {
      method: 'POST',
      path: '/users/:id/posts',
      summary: 'Write a post',
      tags: ['posts'],
      body: NewPost,
      responses: { 201: Post, 404: ErrorBody },
    },
    publishPost: {
      method: 'PATCH',
      path: '/posts/:postId',
      summary: 'Update a post',
      tags: ['posts'],
      body: NewPost.partial(),
      responses: { 200: Post, 404: ErrorBody },
    },
  },
});
