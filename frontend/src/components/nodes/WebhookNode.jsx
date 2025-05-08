import React from 'react';
import BaseNode from './BaseNode';
import SendIcon from '@mui/icons-material/Send'; // Webhook Icon

function WebhookNode(props) {
    return (
        <BaseNode {...props}>
            <SendIcon fontSize="small" sx={{ transform: 'rotate(-45deg)' }} /> {/* Rotate icon slightly */}
        </BaseNode>
    );
}

export default React.memo(WebhookNode); 