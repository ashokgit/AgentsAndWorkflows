import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import InfoIcon from '@mui/icons-material/Info';
import CancelIcon from '@mui/icons-material/Cancel';
import CodeIcon from '@mui/icons-material/Code';
import Tooltip from '@mui/material/Tooltip';

// Basic styles - can be moved to a CSS file
const logContainerStyle = {
    fontFamily: 'monospace',
    fontSize: '13px',
    padding: '10px',
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
    lineHeight: '1.4',
};

const logEntryStyle = {
    marginBottom: '8px',
    paddingBottom: '8px',
    borderBottom: '1px dashed #eee',
};

const getStatusColor = (status) => {
    switch (status) {
        case 'Success': return '#4CAF50'; // Green
        case 'Failed': return '#F44336'; // Red
        case 'Pending': return '#FF9800'; // Orange
        case 'Aborted (Client Disconnected)': return '#757575'; // Grey
        default: return '#333'; // Default text color
    }
};

const statusStyle = (status) => ({
    fontWeight: 'bold',
    color: getStatusColor(status),
    display: 'inline-block',
    minWidth: '60px',
    marginRight: '10px',
});

const timestampStyle = {
    color: '#888',
    fontSize: '11px',
    marginRight: '10px',
};

const dataStyle = {
    marginTop: '4px',
    marginLeft: '20px',
    padding: '5px',
    backgroundColor: '#f9f9f9',
    border: '1px solid #eee',
    borderRadius: '3px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: '100px',
    overflowY: 'auto',
    fontSize: '12px',
};

const errorStyle = {
    ...dataStyle,
    color: '#D32F2F',
    backgroundColor: '#FFEBEE',
    borderColor: '#FFCDD2',
};

function LogDisplay({ logs }) {
    // Track expanded state for efficiency when there are many logs
    const [expandedLogIndex, setExpandedLogIndex] = useState(null);

    const handleExpandChange = (index) => (event, isExpanded) => {
        setExpandedLogIndex(isExpanded ? index : null);
    };

    // Get the appropriate chip color based on status
    const getStatusProps = (status) => {
        switch (status) {
            case 'Success':
                return { color: 'success', icon: <CheckCircleIcon fontSize="small" /> };
            case 'Failed':
                return { color: 'error', icon: <ErrorIcon fontSize="small" /> };
            case 'Pending':
                return { color: 'warning', icon: <HourglassEmptyIcon fontSize="small" /> };
            case 'Aborted (Client Disconnected)':
                return { color: 'default', icon: <CancelIcon fontSize="small" /> };
            default:
                return { color: 'info', icon: <InfoIcon fontSize="small" /> };
        }
    };

    // Format timestamp from Unix seconds to readable time
    const formatTimestamp = (timestamp) => {
        if (!timestamp) return '-';
        return new Date(timestamp * 1000).toLocaleTimeString();
    };

    // Render log content including error or data details
    const renderLogContent = (log) => {
        const hasData = log.input_data || log.output_data;
        const isError = log.status === 'Failed' && log.error;

        return (
            <Box sx={{ pl: 2 }}>
                {isError && (
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 1,
                            mb: hasData ? 1 : 0,
                            bgcolor: 'error.lightest',
                            borderColor: 'error.light',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                        }}
                    >
                        <Typography variant="body2" component="div" color="error">
                            <strong>Error:</strong> {String(log.error)}
                        </Typography>
                    </Paper>
                )}

                {hasData && (
                    <Box>
                        {log.input_data && (
                            <Paper
                                variant="outlined"
                                sx={{
                                    p: 1,
                                    mb: log.output_data ? 1 : 0,
                                    bgcolor: 'grey.50',
                                    fontFamily: 'monospace',
                                    fontSize: '0.75rem'
                                }}
                            >
                                <Typography variant="caption" component="div" sx={{ mb: 0.5, fontWeight: 'bold' }}>
                                    Input Data:
                                </Typography>
                                <Typography
                                    component="pre"
                                    sx={{
                                        m: 0,
                                        p: 0,
                                        overflowX: 'auto',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word'
                                    }}
                                >
                                    {JSON.stringify(log.input_data, null, 2)}
                                </Typography>
                            </Paper>
                        )}

                        {log.output_data && (
                            <Paper
                                variant="outlined"
                                sx={{
                                    p: 1,
                                    bgcolor: 'grey.50',
                                    fontFamily: 'monospace',
                                    fontSize: '0.75rem'
                                }}
                            >
                                <Typography variant="caption" component="div" sx={{ mb: 0.5, fontWeight: 'bold' }}>
                                    Output Data:
                                </Typography>
                                <Typography
                                    component="pre"
                                    sx={{
                                        m: 0,
                                        p: 0,
                                        overflowX: 'auto',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word'
                                    }}
                                >
                                    {JSON.stringify(log.output_data, null, 2)}
                                </Typography>
                            </Paper>
                        )}
                    </Box>
                )}
            </Box>
        );
    };

    if (!logs || logs.length === 0) {
        return (
            <Box
                sx={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'background.paper',
                    p: 2
                }}
            >
                <Typography variant="body2" color="text.secondary">
                    No logs available. Run the workflow to see execution logs.
                </Typography>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                height: '100%',
                overflowY: 'auto',
                p: 1,
                bgcolor: 'background.paper'
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2" fontWeight="medium">
                    Execution Logs
                </Typography>
                <Chip
                    size="small"
                    label={`${logs.length} entries`}
                    color="primary"
                    variant="outlined"
                />
            </Box>
            <Divider sx={{ mb: 1 }} />

            {logs.map((log, index) => {
                const { color, icon } = getStatusProps(log.status);
                const timestamp = formatTimestamp(log.timestamp);
                const hasDetails = (log.status === 'Failed' && log.error) || log.input_data || log.output_data;
                const logId = `${log.run_id || 'init'}-${index}`;

                return (
                    <Box
                        key={logId}
                        sx={{
                            mb: 0.75,
                            bgcolor: index % 2 === 0 ? 'grey.50' : 'background.paper',
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: 'divider'
                        }}
                    >
                        <Box
                            sx={{
                                p: 0.75,
                                display: 'flex',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 1
                            }}
                        >
                            <Typography variant="caption" component="span" color="text.secondary">
                                {timestamp}
                            </Typography>

                            <Chip
                                size="small"
                                icon={icon}
                                label={log.status || 'INFO'}
                                color={color}
                                variant="filled"
                                sx={{ height: 24, fontWeight: 500 }}
                            />

                            <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>
                                {log.step || 'Log Message'}
                            </Typography>

                            {log.node_id && (
                                <Tooltip title="Node ID">
                                    <Chip
                                        size="small"
                                        icon={<CodeIcon fontSize="small" />}
                                        label={log.node_id}
                                        color="info"
                                        variant="outlined"
                                        sx={{ height: 20, fontSize: '0.7rem' }}
                                    />
                                </Tooltip>
                            )}
                        </Box>

                        {hasDetails && (
                            <Accordion
                                expanded={expandedLogIndex === index}
                                onChange={handleExpandChange(index)}
                                disableGutters
                                elevation={0}
                                sx={{
                                    '&:before': { display: 'none' }, // Remove default divider
                                    '& .MuiAccordionSummary-root': {
                                        minHeight: 28,
                                        p: 0,
                                        pl: 2,
                                        pr: 1
                                    }
                                }}
                            >
                                <AccordionSummary
                                    expandIcon={<ExpandMoreIcon fontSize="small" />}
                                    sx={{ bgcolor: 'action.hover', borderTop: '1px solid', borderTopColor: 'divider' }}
                                >
                                    <Typography variant="caption" color="text.secondary">
                                        {log.status === 'Failed' && log.error ? 'Error details' : 'Data'}
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails sx={{ p: 1, pt: 0 }}>
                                    {renderLogContent(log)}
                                </AccordionDetails>
                            </Accordion>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
}

export default LogDisplay; 