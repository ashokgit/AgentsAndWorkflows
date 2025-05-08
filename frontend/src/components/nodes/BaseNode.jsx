import React, { useEffect, useState, useMemo } from 'react';
import { Handle, Position } from 'reactflow';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { motion } from 'framer-motion';
import ErrorIcon from '@mui/icons-material/Error';
import Tooltip from '@mui/material/Tooltip';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import CircularProgress from '@mui/material/CircularProgress';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import SettingsIcon from '@mui/icons-material/Settings';
import Chip from '@mui/material/Chip';

// Basic styles for Handles
const handleStyle = (theme, position, status, nodeType) => {
    let color = theme.palette.primary.dark;
    if (nodeType === 'model_config') {
        color = theme.palette.secondary.main; // Use a distinct color for config nodes
    } else {
        switch (status) {
            case 'Success':
            case 'Triggered': // Success state for webhooks in tests
                color = theme.palette.success.main; break;
            case 'Failed': color = theme.palette.error.main; break;
            case 'Running':
            case 'Pending': color = theme.palette.info.main; break;
            case 'Waiting': color = theme.palette.warning.main; break;
            default: color = theme.palette.primary.dark;
        }
    }
    return {
        width: 8, height: 8, background: color, border: 'none', borderRadius: '50%',
        ...(position === Position.Top && { top: -5 }),
        ...(position === Position.Bottom && { bottom: -5 }),
        ...(position === Position.Left && { left: -5 }),
        ...(position === Position.Right && { right: -5 }),
        transition: 'background-color 0.3s',
    };
};

// Define animation variants FACTORY function that takes theme
const getNodeVariants = (theme) => ({
    idle: (selected, nodeType) => ({
        borderColor: selected ? theme.palette.primary.main :
            nodeType === 'model_config' ? theme.palette.secondary.light :
                theme.palette.divider,
        boxShadow: selected ? '0 8px 16px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.05)',
        scale: 1,
        transition: { duration: 0.2 }
    }),
    pending: {
        borderColor: theme.palette.warning.main, // Use theme colors
        boxShadow: `0 0 12px ${theme.palette.warning.light}`,
        scale: 1.03,
        transition: {
            duration: 0.4,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut"
        }
    },
    running: {
        borderColor: theme.palette.info.main,
        boxShadow: `0 0 12px ${theme.palette.info.light}`,
        scale: 1.03,
        transition: {
            duration: 0.4,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut"
        }
    },
    waiting: {
        borderColor: theme.palette.secondary.main, // Use theme colors
        boxShadow: `0 0 12px ${theme.palette.secondary.light}`,
        scale: 1.02,
        transition: {
            duration: 0.8,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut"
        }
    },
    success: (selected, nodeType) => ({
        borderColor: nodeType === 'model_config' ? theme.palette.secondary.main : theme.palette.success.main,
        boxShadow: `0 0 10px ${theme.palette.success.light}`,
        scale: 1,
        transition: { duration: 0.3 }
    }),
    failed: {
        borderColor: theme.palette.error.main,
        boxShadow: `0 0 12px ${theme.palette.error.light}`,
        backgroundColor: theme.palette.error.lighter, // Use theme variable
        scale: 1,
        transition: { duration: 0.3 }
    },
    dataUpdate: {
        borderColor: theme.palette.success.main,
        boxShadow: `0 0 15px ${theme.palette.success.dark}`,
        scale: 1.05,
        transition: {
            duration: 0.3,
            repeat: 3,
            repeatType: "reverse",
            ease: "easeInOut"
        }
    }
});

// Get status icon based on current status
const getStatusIcon = (status, nodeType) => {
    if (nodeType === 'model_config') return <SettingsIcon fontSize="small" color="secondary" />;

    switch (status) {
        case 'Success':
        case 'Triggered': return <CheckCircleIcon fontSize="small" color="success" />;
        case 'Failed': return <CancelIcon fontSize="small" color="error" />;
        case 'Running':
        case 'Pending': return <CircularProgress size={16} color="info" />;
        case 'Waiting': return <HourglassEmptyIcon fontSize="small" color="warning" />;
        default: return null;
    }
};

// Get status color based on current status
const getStatusColor = (status, nodeType) => {
    if (nodeType === 'model_config') return 'secondary';

    switch (status) {
        case 'Success':
        case 'Triggered': return 'success';
        case 'Failed': return 'error';
        case 'Running':
        case 'Pending': return 'info';
        case 'Waiting': return 'warning';
        default: return 'default';
    }
};

// BaseNode component
const BaseNode = ({ id, type, data, selected, children }) => {
    const theme = useTheme();
    // Extract node_name, config_name, or webhook_name for display priority
    const displayName = data?.node_name || data?.config_name || data?.webhook_name || data?.label || 'Node';
    const { status, validationError } = data || {};
    const [currentStatus, setCurrentStatus] = useState(status || (type === 'model_config' ? 'Configured' : 'idle'));
    const [dataUpdateEffect, setDataUpdateEffect] = useState(false);
    const [lastDataSnapshot, setLastDataSnapshot] = useState(null);

    // Memoize the node variants based on the theme
    const nodeVariants = useMemo(() => getNodeVariants(theme), [theme]);

    // Effect to detect changes in data
    useEffect(() => {
        if (!data) return;

        const currentDataStr = JSON.stringify(data);

        // Check if this is a webhook node and it has a last_payload
        const isWebhookWithPayload = type === 'webhook_trigger' && data.last_payload && data.last_payload !== lastDataSnapshot?.last_payload;

        if (lastDataSnapshot && (isWebhookWithPayload || currentDataStr !== JSON.stringify(lastDataSnapshot))) {
            // Trigger update animation
            console.log("BaseNode: Data changed, triggering update effect");
            setDataUpdateEffect(true);

            // Reset after animation completes
            const timer = setTimeout(() => {
                setDataUpdateEffect(false);
                setCurrentStatus(status || (type === 'model_config' ? 'Configured' : 'idle'));
            }, 1500);

            return () => clearTimeout(timer);
        }

        // Update the snapshot
        setLastDataSnapshot(data);
        setCurrentStatus(status || (type === 'model_config' ? 'Configured' : 'idle'));
    }, [data, status, lastDataSnapshot, type]);

    // Determine animation variant based on status
    const getAnimationVariant = () => {
        // Data update effect takes precedence
        if (dataUpdateEffect) {
            return 'dataUpdate';
        }

        if (type === 'model_config') return 'idle'; // Model config nodes don't animate based on operational status

        switch ((currentStatus || '').toLowerCase()) {
            case 'running':
                return 'running';
            case 'pending':
                return 'pending';
            case 'waiting':
                return 'waiting';
            case 'success':
            case 'triggered': // Added for webhook test signal
            case 'completed':
                return 'success';
            case 'failed':
            case 'error':
                return 'failed';
            default:
                return 'idle';
        }
    };

    // Determine status label for display
    const displayStatus = type === 'model_config' ? 'Configured' : status;
    const showStatusChip = !!status && type !== 'model_config'; // Only show chip for operational nodes with status

    return (
        <motion.div
            initial="idle"
            animate={getAnimationVariant()}
            custom={[selected, type]}
            variants={nodeVariants}
            drag={false}
            whileTap={{ scale: 0.98 }}
            style={{
                touchAction: 'none',
                userSelect: 'none'
            }}
        >
            <Paper
                sx={{
                    padding: '10px 15px',
                    borderRadius: '8px',
                    border: `2px solid ${selected ? theme.palette.primary.main :
                        validationError ? theme.palette.error.main :
                            type === 'model_config' ? theme.palette.secondary.light :
                                theme.palette.divider
                        }`,
                    background: theme.palette.background.paper,
                    backgroundColor:
                        type === 'model_config' ? theme.palette.secondary.lighter :
                            status === 'Failed' ? theme.palette.error.lighter :
                                (status === 'Success' || status === 'Triggered') ? theme.palette.success.lighter :
                                    (status === 'Running' || status === 'Pending') ? theme.palette.info.lighter :
                                        status === 'Waiting' ? theme.palette.warning.lighter :
                                            validationError ? theme.palette.error.lightest :
                                                dataUpdateEffect ? theme.palette.success.lightest :
                                                    theme.palette.background.paper,
                    minWidth: '180px',
                    maxWidth: '250px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    outline: 'none',
                    overflow: 'hidden'
                }}
            >
                {/* Input Handle (Top) */}
                <Handle
                    type="target"
                    position={Position.Top}
                    id="top"
                    style={handleStyle(theme, Position.Top, status, type)}
                />
                {/* Input Handle (Left) */}
                <Handle
                    type="target"
                    position={Position.Left}
                    id="left"
                    style={handleStyle(theme, Position.Left, status, type)}
                />

                {/* Node Header Content */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    {/* Icon passed as children */}
                    {children && (
                        <Box sx={{ display: 'flex', alignItems: 'center', color: theme.palette.text.secondary }}>
                            {children}
                        </Box>
                    )}
                    <Typography
                        variant="body2"
                        sx={{
                            fontWeight: 500,
                            flexGrow: 1,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis'
                        }}
                    >
                        {displayName}
                    </Typography>

                    {/* Validation Error Indicator */}
                    {validationError && (
                        <Tooltip title={validationError} arrow placement="top">
                            <ErrorIcon
                                color="error"
                                fontSize="small"
                                sx={{ flexShrink: 0 }}
                            />
                        </Tooltip>
                    )}
                </Box>

                {/* Status Indicator (if has status) */}
                {showStatusChip && (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
                        <Chip
                            size="small"
                            label={displayStatus || 'Idle'}
                            color={getStatusColor(displayStatus, type)}
                            icon={getStatusIcon(displayStatus, type)}
                            variant="outlined"
                            sx={{
                                height: 20,
                                '& .MuiChip-label': {
                                    px: 1,
                                    fontSize: '0.7rem',
                                    fontWeight: 'bold'
                                },
                                '& .MuiChip-icon': {
                                    ml: 0.5,
                                    fontSize: 14
                                }
                            }}
                        />
                    </Box>
                )}

                {/* Special case for ModelConfig: always show a static chip */}
                {type === 'model_config' && (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
                        <Chip
                            size="small"
                            label="Config"
                            color="secondary"
                            icon={<SettingsIcon sx={{ fontSize: 14 }} />}
                            variant="outlined"
                            sx={{ height: 20, '& .MuiChip-label': { px: 1, fontSize: '0.7rem' } }}
                        />
                    </Box>
                )}

                {/* Output Handle (Right) */}
                <Handle
                    type="source"
                    position={Position.Right}
                    id="right"
                    style={handleStyle(theme, Position.Right, status, type)}
                />
                {/* Output Handle (Bottom) */}
                <Handle
                    type="source"
                    position={Position.Bottom}
                    id="bottom"
                    style={handleStyle(theme, Position.Bottom, status, type)}
                />
            </Paper>
        </motion.div>
    );
};

// Remove memo to ensure component always updates when props change
export default BaseNode; 