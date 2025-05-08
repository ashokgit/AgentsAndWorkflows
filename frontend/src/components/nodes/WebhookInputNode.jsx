import React, { useEffect, useState } from 'react';
import BaseNode from './BaseNode';
import WebhookIcon from '@mui/icons-material/Webhook';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';

function WebhookInputNode(props) {
    const [hasPayload, setHasPayload] = useState(!!props.data?.last_payload);
    const [updateTime, setUpdateTime] = useState(Date.now());
    const [animateUpdate, setAnimateUpdate] = useState(false);
    const [lastPayloadJson, setLastPayloadJson] = useState('');

    // Keep track of the current payload JSON for comparison
    const currentPayloadJson = props.data?.last_payload ? JSON.stringify(props.data?.last_payload) : '';

    // Effect to detect changes in webhook data
    useEffect(() => {
        const newHasPayload = !!props.data?.last_payload;

        // If we have a new payload when we didn't before, or payload changed
        if (newHasPayload && (currentPayloadJson !== lastPayloadJson || !hasPayload)) {
            console.log("WebhookInputNode: New webhook data detected");
            setUpdateTime(Date.now());
            setAnimateUpdate(true);
            setLastPayloadJson(currentPayloadJson);

            // Reset animation after 2 seconds
            const timer = setTimeout(() => {
                setAnimateUpdate(false);
            }, 2000);

            return () => clearTimeout(timer);
        }

        setHasPayload(newHasPayload);
    }, [props.data?.last_payload, hasPayload, currentPayloadJson, lastPayloadJson]);

    // Format updateTime to show when data was last updated
    const lastUpdateText = hasPayload
        ? `Data received: ${new Date(updateTime).toLocaleTimeString()}`
        : "Waiting for webhook data";

    return (
        <BaseNode {...props}>
            <Tooltip title={lastUpdateText}>
                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <Badge
                        variant="dot"
                        color={hasPayload ? "success" : "default"}
                        overlap="circular"
                        sx={{
                            '& .MuiBadge-badge': {
                                transform: 'scale(1.5)',
                                animation: animateUpdate ? 'pulse 1.5s infinite' : 'none'
                            },
                            '@keyframes pulse': {
                                '0%': { boxShadow: '0 0 0 0 rgba(76, 175, 80, 0.7)' },
                                '70%': { boxShadow: '0 0 0 6px rgba(76, 175, 80, 0)' },
                                '100%': { boxShadow: '0 0 0 0 rgba(76, 175, 80, 0)' }
                            }
                        }}
                    >
                        <WebhookIcon
                            fontSize="small"
                            color={hasPayload ? "primary" : "inherit"}
                        />
                    </Badge>
                    {animateUpdate && (
                        <CircularProgress
                            size={24}
                            thickness={2}
                            sx={{
                                position: 'absolute',
                                top: -4,
                                left: -4,
                                color: '#4caf50'
                            }}
                        />
                    )}
                </Box>
            </Tooltip>
        </BaseNode>
    );
}

// Export without memo to ensure component always updates when props change
export default WebhookInputNode; 