import React from 'react';
import BaseNode from './BaseNode';
import WebhookIcon from '@mui/icons-material/Webhook';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

function WebhookInputNode(props) {
    const hasPayload = props.data?.last_payload;

    return (
        <BaseNode {...props}>
            <Tooltip title={hasPayload ? "Webhook data received" : "Waiting for webhook data"}>
                <Badge
                    variant="dot"
                    color={hasPayload ? "success" : "default"}
                    overlap="circular"
                    sx={{ '& .MuiBadge-badge': { transform: 'scale(1.5)' } }}
                >
                    <WebhookIcon
                        fontSize="small"
                        color={hasPayload ? "primary" : "inherit"}
                    />
                </Badge>
            </Tooltip>
        </BaseNode>
    );
}

export default React.memo(WebhookInputNode); 