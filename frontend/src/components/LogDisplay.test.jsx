import { render, screen } from '@testing-library/react';
import LogDisplay from './LogDisplay';
import { describe, it, expect, vi } from 'vitest'; // Ensure vi is imported for mocking

// Mock MUI styled components
vi.mock('@mui/material/styles', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        styled: (Component, options) => {
            return (stylesOrStyleFunction) => {
                const StyledComponentFactory = (props) => {
                    const shouldForwardProp = options?.shouldForwardProp;
                    const forwardedProps = { ...props };

                    if (shouldForwardProp && typeof shouldForwardProp === 'function') {
                        for (const propName in props) {
                            if (props.hasOwnProperty(propName) && !shouldForwardProp(propName)) {
                                delete forwardedProps[propName];
                            }
                        }
                    }

                    const displayName = typeof Component === 'string' ? Component : (Component.displayName || Component.name || 'BaseComponent');
                    return <Component {...forwardedProps} data-testid={`styled-${displayName.toLowerCase()}`} />;
                };

                const factoryDisplayName = typeof Component === 'string' ? Component : (Component.displayName || Component.name || 'Component');
                StyledComponentFactory.displayName = `Styled(${factoryDisplayName})`;
                return StyledComponentFactory;
            };
        },
    };
});

// Mock icons to prevent errors if not rendered correctly in JSDOM
// These mocks return simple divs with test-ids.
vi.mock('@mui/icons-material/ExpandMore', () => ({ default: () => <div data-testid="expand-more-icon" /> }));
vi.mock('@mui/icons-material/CheckCircle', () => ({ default: () => <div data-testid="check-circle-icon" /> }));
vi.mock('@mui/icons-material/Error', () => ({ default: () => <div data-testid="error-icon" /> }));
vi.mock('@mui/icons-material/HourglassEmpty', () => ({ default: () => <div data-testid="hourglass-empty-icon" /> }));
vi.mock('@mui/icons-material/Info', () => ({ default: () => <div data-testid="info-icon" /> }));
vi.mock('@mui/icons-material/Cancel', () => ({ default: () => <div data-testid="cancel-icon" /> }));
vi.mock('@mui/icons-material/Science', () => ({ default: () => <div data-testid="science-icon" /> }));
vi.mock('@mui/icons-material/Code', () => ({ default: () => <div data-testid="code-icon" /> }));


describe('LogDisplay Component', () => {
    it('renders "No logs available" when no logs are provided', () => {
        render(<LogDisplay logs={[]} />);
        expect(screen.getByText(/No logs available/i)).toBeInTheDocument();
        expect(screen.getByText(/Run or test the workflow/i)).toBeInTheDocument();
    });

    it('renders "No logs available" when logs prop is undefined', () => {
        render(<LogDisplay />); // No logs prop
        expect(screen.getByText(/No logs available/i)).toBeInTheDocument();
    });

    it('renders execution logs title and entry count when logs are provided', () => {
        const mockLogs = [
            { run_id: 'r1', timestamp: Date.now() / 1000, status: 'success', step: 'Step 1', message: 'First log' },
            { run_id: 'r2', timestamp: Date.now() / 1000 + 1, status: 'failed', step: 'Step 2', error: 'Something went wrong' },
        ];
        render(<LogDisplay logs={mockLogs} />);
        expect(screen.getByText(/Execution Logs/i)).toBeInTheDocument();
        expect(screen.getByText(/2 entries/i)).toBeInTheDocument(); // Chip with count
    });

    it('renders basic information for a single log entry', () => {
        const mockLogs = [
            { run_id: 'run1', timestamp: Date.now() / 1000, status: 'success', step: 'Test Step', node_id: 'node-123' },
        ];
        render(<LogDisplay logs={mockLogs} />);
        expect(screen.getByText(/Test Step/i)).toBeInTheDocument(); // Assuming 'step' is displayed as part of AccordionSummary
        // Check for the success icon mock
        expect(screen.getByTestId('check-circle-icon')).toBeInTheDocument();
    });

    // TODO: Add more tests:
    // - Test log expansion (simulating click on AccordionSummary and checking for AccordionDetails content)
    // - Test different log statuses and ensure the correct mock icon is rendered.
    // - Test timestamp formatting (formatTimestamp) - this might require a more direct unit test of the helper if not easily verifiable in the component output.
    // - Test rendering of input_data_summary, output_data_summary, error sections when expanded.
    // - Test the 'is_test_log' indicator (e.g., presence of science-icon and specific styling if mockable).
}); 