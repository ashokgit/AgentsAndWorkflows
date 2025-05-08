import React from 'react';
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
};

// BaseNode component
const BaseNode = ({ data, selected, children }) => {
    const theme = useTheme();
    const { label, status, validationError } = data || { label: 'Node' };
    const currentStatus = status || 'idle';

    // Determine animation variant based on status
    const getAnimationVariant = () => {
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
                        validationError ? 'rgba(211,47,47,0.05)' : theme.palette.background.paper,
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

export default React.memo(BaseNode); 