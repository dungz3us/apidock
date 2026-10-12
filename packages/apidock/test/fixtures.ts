import { z } from 'zod';
import { defineApi } from '../src/index.js';

export const User = z
  .object({
    id: z.string().meta({ example: 'u_1' }),
    name: z.string().min(1),
    email: z.email(),
  })
  .meta({ id: 'User' });

export const ErrorBody = z.object({ error: z.string() }).meta({ id: 'Error' });

export const testApi = defineApi({
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  routes: {
    listUsers: {
      method: 'GET',
      path: '/users',
      tags: ['users'],
      query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }),
      responses: { 200: z.array(User) },
    },
    getUser: {
      method: 'GET',
      path: '/users/:id',
      summary: 'Get user',
      tags: ['users'],
      params: z.object({ id: z.string() }),
      responses: { 200: User, 404: { schema: ErrorBody, description: 'User not found' } },
    },
    createUser: {
      method: 'POST',
      path: '/users',
      tags: ['users'],
      body: User.omit({ id: true }),
      responses: { 201: User, 400: ErrorBody },
    },
    deleteUser: {
      method: 'DELETE',
      path: '/users/:id',
      tags: ['users'],
      responses: { 204: { description: 'Deleted' } },
    },
  },
});
