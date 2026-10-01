import { describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent } from '@rqi/testing'
import { JobDescriptionForm } from './job-description-form'

const pasteMock = vi.fn()
const uploadMock = vi.fn()
vi.mock('@/lib/job-descriptions/actions', () => ({
  pasteJobDescriptionAction: (...args: unknown[]) => pasteMock(...args),
  uploadJobDescriptionAction: (...args: unknown[]) => uploadMock(...args),
}))

const props = {
  organizationId: 'org-1',
  projectId: 'proj-1',
  projectClientId: 'client-1',
  jobId: 'job-1',
}

describe('JobDescriptionForm — Build Phase 3 brief §"Job-description intake"', () => {
  it('defaults to the paste-text mode with a text area', () => {
    render(<JobDescriptionForm {...props} />)
    expect(screen.getByLabelText(/job description text/i)).toBeInTheDocument()
  })

  it('switches to a file input in upload mode, and back', async () => {
    const user = userEvent.setup()
    render(<JobDescriptionForm {...props} />)

    await user.click(screen.getByRole('button', { name: /upload file/i }))
    expect(screen.getByLabelText(/job description file/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/job description text/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /paste text/i }))
    expect(screen.getByLabelText(/job description text/i)).toBeInTheDocument()
  })

  it('submits pasted text through the paste action, not the upload action', async () => {
    pasteMock.mockResolvedValue({ success: true, message: 'Job description saved.' })
    const user = userEvent.setup()
    render(<JobDescriptionForm {...props} />)

    await user.type(
      screen.getByLabelText(/job description text/i),
      'A full job description with more than twenty characters.',
    )
    await user.click(screen.getByRole('button', { name: /save job description/i }))

    expect(await screen.findByText('Job description saved.')).toBeInTheDocument()
    expect(pasteMock).toHaveBeenCalledTimes(1)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('surfaces a file-rejection message returned by the upload action verbatim (never inventing success)', async () => {
    uploadMock.mockResolvedValue({ success: false, message: 'Executable files are not allowed.' })
    const user = userEvent.setup()
    render(<JobDescriptionForm {...props} />)

    await user.click(screen.getByRole('button', { name: /upload file/i }))
    const file = new File(['bad'], 'payload.exe', { type: 'application/x-msdownload' })
    const input = screen.getByLabelText(/job description file/i)
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: /upload job description/i }))

    expect(await screen.findByText('Executable files are not allowed.')).toBeInTheDocument()
  })
})
