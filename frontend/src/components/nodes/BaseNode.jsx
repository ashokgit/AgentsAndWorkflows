import React, { useEffect, useState } from 'react';
import { Handle, Position } from 'reactflow';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { motion } from 'framer-motion';
import ErrorIcon from '@mui/icons-material/Error';
import Tooltip from '@mui/material/Tooltip';

// Basic styles for Handles
const handleStyle = (theme, position) => ({
    width: 8,
    height: 8,
    background: theme.palette.primary.dark,
    border: 'none',
    borderRadius: '50%',
    ...(position === Position.Top && { top: -5 }),
    ...(position === Position.Bottom && { bottom: -5 }),
    ...(position === Position.Left && { left: -5 }),
    ...(position === Position.Right && { right: -5 }),
});

// Define animation variants for node statuses
const nodeVariants = {
    idle: (selected) => ({
        borderColor: selected ? '#1976d2' : '#e0e0e0',
        boxShadow: selected ? '0 8px 16px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.05)',
        scale: 1,
        transition: { duration: 0.2 }
    }),
    pending: {
        borderColor: '#ed6c02',
        boxShadow: '0 0 12px rgba(237,108,2,0.4)',
        scale: 1.03,
        transition: {
            duration: 0.4,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut"
        }
    },
    success: {
        borderColor: '#2e7d32',
        boxShadow: '0 0 10px rgba(46,125,50,0.4)',
        scale: 1,
        transition: { duration: 0.3 }
    },
    failed: {
        borderColor: '#d32f2f',
        boxShadow: '0 0 12px rgba(211,47,47,0.4)',
        backgroundColor: 'rgba(211,47,47,0.05)',
        scale: 1,
        transition: { duration: 0.3 }
    },
    dataUpdate: {
        borderColor: '#4caf50',
        boxShadow: '0 0 15px rgba(76,175,80,0.6)',
        scale: 1.05,
        transition: {
            duration: 0.3,
            repeat: 3,
            repeatType: "reverse",
            ease: "easeInOut"
        }
    }
};

// BaseNode component
const BaseNode = ({ data, selected, children }) => {
    const theme = useTheme();
    const { label, status, validationError } = data || { label: 'Node' };
    const [currentStatus, setCurrentStatus] = useState(status || 'idle');
    const [dataUpdateEffect, setDataUpdateEffect] = useState(false);
    const [lastDataSnapshot, setLastDataSnapshot] = useState(null);

    // Effect to detect changes in data
    useEffect(() => {
        if (!data) return;

        const currentDataStr = JSON.stringify(data);

        // Check if this is a webhook node and it has a last_payload
        const isWebhookWithPayload = data.last_payload && data.last_payload !== lastDataSnapshot?.last_payload;

        if (lastDataSnapshot && (isWebhookWithPayload || currentDataStr !== JSON.stringify(lastDataSnapshot))) {
            // Trigger update animation
            console.log("BaseNode: Data changed, triggering update effect");
            setDataUpdateEffect(true);

            // Reset after animation completes
            const timer = setTimeout(() => {
                setDataUpdateEffect(false);
                setCurrentStatus(status || 'idle');
            }, 1500);

            return () => clearTimeout(timer);
        }

        // Update the snapshot
        setLastDataSnapshot(data);
        setCurrentStatus(status || 'idle');
    }, [data, status, lastDataSnapshot]);

    // Determine animation variant based on status
    const getAnimationVariant = () => {
        // Data update effect takes precedence
        if (dataUpdateEffect) {
            return 'dataUpdate';
        }

        switch (currentStatus.toLowerCase()) {
            case 'running':
            case 'pending':
                return 'pending';
            case 'success':
            case 'completed':
                return 'success';
            case 'failed':
            case 'error':
                return 'failed';
            default:
                return 'idle';
        }
    };

    return (
        <motion.div
            initial="idle"
            animate={getAnimationVariant()}
            custom={selected}
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
                    border: `1px solid ${selected ? theme.palette.primary.main : validationError ? theme.palette.error.main : theme.palette.divider}`,
                    background: theme.palette.background.paper,
                    backgroundColor: status === 'Failed' ? theme.palette.error.lighter :
                        validationError ? 'rgba(211,47,47,0.05)' :
                            dataUpdateEffect ? 'rgba(76,175,80,0.08)' : theme.palette.background.paper,
                    minWidth: '180px',
                    maxWidth: '250px',
                    display: 'flex',
                    alignItems: 'center',
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
                    style={handleStyle(theme, Position.Top)}
                />
                {/* Input Handle (Left) */}
                <Handle
                    type="target"
                    position={Position.Left}
                    id="left"
                    style={handleStyle(theme, Position.Left)}
                />

                {/* Node Content */}
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
                        {label || 'Node'}
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

                {/* Output Handle (Right) */}
                <Handle
                    type="source"
                    position={Position.Right}
                    id="right"
                    style={handleStyle(theme, Position.Right)}
                />
                {/* Output Handle (Bottom) */}
                <Handle
                    type="source"
                    position={Position.Bottom}
                    id="bottom"
                    style={handleStyle(theme, Position.Bottom)}
                />
            </Paper>
        </motion.div>
    );
};

// Remove memo to ensure component always updates when props change
export default BaseNode; 