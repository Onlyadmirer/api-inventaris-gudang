import { describe, expect, it } from 'bun:test'
import { app } from './index'

describe('GET /api/health', () => {
  it('mengembalikan status ok', async () => {
    const res = await app.handle(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
