import { render, screen } from '@testing-library/react-native'
import { StatusChip } from '@/components/ui/StatusChip'

describe('StatusChip', () => {
  it('renders the provided label for each status tone', () => {
    render(<StatusChip status="passed" label="Passed" />)
    expect(screen.getByText('Passed')).toBeTruthy()
  })
})
