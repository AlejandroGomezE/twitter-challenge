import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiUrl, server } from '@/test/server'
import { ApiError, apiClient } from '../client'

describe('apiClient', () => {
  it('returns the parsed JSON body', async () => {
    server.use(http.get(apiUrl('/thing'), () => HttpResponse.json({ id: 't1' })))

    await expect(apiClient.get('/thing')).resolves.toEqual({ id: 't1' })
  })

  it('sends a JSON body on POST', async () => {
    server.use(http.post(apiUrl('/echo'), async ({ request }) => HttpResponse.json(await request.json())))

    await expect(apiClient.post('/echo', { text: 'hi' })).resolves.toEqual({ text: 'hi' })
  })

  it('throws an ApiError carrying the status and server message', async () => {
    server.use(
      http.get(apiUrl('/missing'), () => HttpResponse.json({ message: 'Not found' }, { status: 404 })),
    )

    const error = await apiClient.get('/missing').catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, message: 'Not found', body: { message: 'Not found' } })
  })

  it('falls back to the status text for a non-JSON error', async () => {
    server.use(
      http.get(apiUrl('/boom'), () => new HttpResponse('oops', { status: 500, statusText: 'Server Error' })),
    )

    await expect(apiClient.get('/boom')).rejects.toMatchObject({ status: 500, message: 'Server Error' })
  })
})
