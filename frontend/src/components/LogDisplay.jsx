import React, { useState, useEffect, useRef } from 'react';
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
import ScienceIcon from '@mui/icons-material/Science'; // Icon for test logs
import CodeIcon from '@mui/icons-material/Code';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import { styled } from '@mui/material/styles';

// Styled components for better organization
const LogContainer = styled(Box)(({ theme }) => ({
    fontFamily: 'monospace',
    fontSize: '13px',
    padding: theme.spacing(1),
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
    lineHeight: '1.4',
    backgroundColor: theme.palette.background.paper,
}));

const LogEntryBox = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'isTestLog'
})(({ theme, isTestLog }) => ({
    marginBottom: theme.spacing(1),
    paddingBottom: theme.spacing(1),
    borderBottom: `1px dashed ${theme.palette.divider}`,
    backgroundColor: isTestLog ? theme.palette.info.lightest : 'transparent',
    borderRadius: isTestLog ? theme.shape.borderRadius : 0,
    padding: isTestLog ? theme.spacing(0.5, 1) : 0,
    position: 'relative',
    overflow: 'hidden', // Needed for the test indicator
    '&:hover': {
        backgroundColor: 'rgba(0, 0, 0, 0.02)',
    },
    // Add a subtle indicator for test logs
    ...(isTestLog && {
        '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '4px',
            backgroundColor: theme.palette.info.main,
        },
        paddingLeft: theme.spacing(2), // Make space for the indicator line
    })
}));

const DataPaper = styled(Paper)(({ theme }) => ({
    padding: theme.spacing(1),
    backgroundColor: theme.palette.grey[50],
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    marginTop: theme.spacing(0.5),
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '150px',
    overflowY: 'auto',
}));

const ErrorPaper = styled(DataPaper)(({ theme }) => ({
    backgroundColor: theme.palette.error.lightest,
    borderColor: theme.palette.error.light,
    color: theme.palette.error.dark,
}));

// LogDisplay component
function LogDisplay({ logs }) {
    const [expandedLogIndex, setExpandedLogIndex] = useState(null);
    const logEndRef = useRef(null); // Ref to scroll to the bottom

    // Scroll to bottom when logs update
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const handleExpandChange = (index) => (event, isExpanded) => {
        setExpandedLogIndex(isExpanded ? index : null);
    };

    // Get chip properties based on status
    const getStatusProps = (status) => {
        switch (String(status).toLowerCase()) {
            case 'success':
            case 'completed':
            case 'configured':
            case 'triggered': // Added for webhook test signal
                return { color: 'success', icon: <CheckCircleIcon sx={{ fontSize: 16 }} /> };
            case 'failed':
            case 'error':
                return { color: 'error', icon: <ErrorIcon sx={{ fontSize: 16 }} /> };
            case 'pending':
                return { color: 'warning', icon: <HourglassEmptyIcon sx={{ fontSize: 16 }} /> };
            case 'aborted':
            case 'aborted (client disconnected)':
                return { color: 'default', icon: <CancelIcon sx={{ fontSize: 16 }} />, variant: 'outlined' };
            case 'waiting': // For webhook test waiting
                return { color: 'secondary', icon: <HourglassEmptyIcon sx={{ fontSize: 16 }} /> };
            default:
                return { color: 'info', icon: <InfoIcon sx={{ fontSize: 16 }} />, variant: 'outlined' };
        }
    };

    // Format timestamp
    const formatTimestamp = (timestamp) => {
        if (!timestamp) return '-';
        try {
            return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (e) {
            return 'Invalid Date';
        }
    };

    // Render data (input/output/error) more concisely
    const renderDataSection = (title, data, isError = false) => {
        if (!data && !isError) return null;

        let content = data;
        if (typeof data === 'object' && data !== null) {
            try {
                content = JSON.stringify(data, null, 2);
            } catch (e) {
                content = String(data);
            }
        } else {
            content = String(data);
        }

        const PaperComponent = isError ? ErrorPaper : DataPaper;

        return (
            <PaperComponent variant="outlined" sx={{ mt: 1 }}>
                <Typography variant="caption" component="div" sx={{ mb: 0.5, fontWeight: 'bold' }}>
                    {title}:
                </Typography>
                <Typography component="pre" sx={{ m: 0, p: 0 }}>
                    {content}
                </Typography>
            </PaperComponent>
        );
    };

    if (!logs || logs.length === 0) {
        return (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
                <Typography variant="body2" color="text.secondary">
                    No logs available. Run or test the workflow.
                </Typography>
            </Box>
        );
    }

    return (
        <LogContainer>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, px: 1 }}>
                <Typography variant="subtitle2" fontWeight="medium">
                    Execution Logs
                </Typography>
                <Chip size="small" label={`${logs.length} entries`} variant="outlined" />
            </Box>
            <Divider sx={{ mb: 1 }} />

            {logs.map((log, index) => {
                const { color, icon, variant = 'filled' } = getStatusProps(log.status);
                const timestamp = formatTimestamp(log.timestamp);
                const isTest = log.is_test_log || false;

                // Extract node ID if present in the step message
                const nodeMatch = log.step?.match(/(?:Node:|Webhook:)\s*([\w-]+)/i);
                const nodeIdFromStep = nodeMatch ? nodeMatch[1] : null;
                const displayNodeId = log.node_id || nodeIdFromStep;

                // Determine if details should be expandable
                const hasDetails = log.error || log.input_data_summary || log.output_data_summary || log.input_data || log.output_data || log.message;
                const isExpanded = expandedLogIndex === index;

                return (
                    <LogEntryBox key={`${log.run_id || 'init'}-${index}-${log.timestamp}`} isTestLog={isTest}>
                        {hasDetails && (
                            <Box
                                sx={{
                                    position: 'absolute',
                                    right: '8px',
                                    top: '8px',
                                    color: 'primary.light',
                                    display: isExpanded ? 'none' : 'block',
                                    zIndex: 1,
                                    opacity: 0.7
                                }}
                            >
                                <Tooltip title="Click to see details">
                                    <span>
                                        <ExpandMoreIcon fontSize="small" />
                                    </span>
                                </Tooltip>
                            </Box>
                        )}
                        <Accordion
                            expanded={isExpanded}
                            onChange={handleExpandChange(index)}
                            disableGutters
                            elevation={0}
                            sx={{
                                backgroundColor: 'transparent',
                                '&::before': { display: 'none' }, // Remove Accordion default border
                                border: 'none',
                                '&:hover': {
                                    backgroundColor: hasDetails ? 'rgba(0, 0, 0, 0.03)' : 'transparent',
                                    transition: 'background-color 0.2s ease',
                                }
                            }}
                        >
                            <AccordionSummary
                                expandIcon={hasDetails ? <ExpandMoreIcon /> : null}
                                aria-controls={`log-content-${index}`}
                                id={`log-header-${index}`}
                                sx={{
                                    minHeight: '36px', // Adjust min height
                                    '& .MuiAccordionSummary-content': {
                                        margin: '8px 0', // Adjust margin
                                        alignItems: 'center',
                                        overflow: 'hidden'
                                    },
                                    // Disable expansion if no details
                                    cursor: hasDetails ? 'pointer' : 'default',
                                    pointerEvents: hasDetails ? 'auto' : 'none',
                                    '& .MuiAccordionSummary-expandIconWrapper': {
                                        color: hasDetails ? 'primary.main' : 'transparent',
                                    }
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1, overflow: 'hidden' }}>
                                    {isTest && (
                                        <Tooltip title="Test Run Log">
                                            <span>
                                                <ScienceIcon color="info" sx={{ fontSize: 16, mr: 0.5 }} />
                                            </span>
                                        </Tooltip>
                                    )}
                                    <Typography variant="caption" sx={{ mr: 1, color: 'text.secondary' }}>
                                        {timestamp}
                                    </Typography>
                                    <Chip
                                        size="small"
                                        label={log.status || 'Info'}
                                        color={color}
                                        icon={icon}
                                        variant={variant}
                                        sx={{ height: 20, mr: 1, fontWeight: 'medium' }}
                                    />
                                    <Typography
                                        variant="body2"
                                        component="span"
                                        sx={{
                                            flexGrow: 1,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis'
                                        }}
                                    >
                                        {log.step}
                                    </Typography>
                                    {displayNodeId && (
                                        <Chip
                                            label={displayNodeId}
                                            size="small"
                                            variant="outlined"
                                            icon={<CodeIcon sx={{ fontSize: 14 }} />}
                                            sx={{ ml: 1, height: 20, cursor: 'pointer' }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                console.log(`Node ID clicked: ${displayNodeId}`);
                                                // Potentially add jump-to-node functionality here
                                            }}
                                        />
                                    )}
                                </Box>
                            </AccordionSummary>
                            {hasDetails && (
                                <AccordionDetails
                                    sx={{
                                        padding: 1,
                                        paddingTop: 0,
                                        backgroundColor: 'rgba(0, 0, 0, 0.02)',
                                        borderRadius: '0 0 4px 4px',
                                        marginTop: '4px'
                                    }}
                                >
                                    {log.error && renderDataSection("Error", log.error, true)}
                                    {log.message && renderDataSection("Message", log.message)}
                                    {log.input_data_summary && renderDataSection("Input Data", log.input_data_summary)}
                                    {log.output_data_summary && renderDataSection("Output Data", log.output_data_summary)}
                                    {/* If we have full data and no summary, show the full data */}
                                    {!log.input_data_summary && log.input_data && renderDataSection("Input Data", log.input_data)}
                                    {!log.output_data_summary && log.output_data && renderDataSection("Output Data", log.output_data)}
                                </AccordionDetails>
                            )}
                        </Accordion>
                    </LogEntryBox>
                );
            })}
            <div ref={logEndRef} /> {/* Element to scroll to */}
        </LogContainer>
    );
}

export default LogDisplay; 