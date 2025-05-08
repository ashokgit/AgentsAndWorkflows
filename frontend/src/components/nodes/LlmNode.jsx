import React from 'react';
import BaseNode from './BaseNode';
import SmartToyIcon from '@mui/icons-material/SmartToy'; // LLM Icon
import CheckCircleIcon from '@mui/icons-material/CheckCircle'; // Success icon
import Box from '@mui/material/Box';

function LlmNode(props) {
    const { data } = props;
    const testSuccess = data?.testSuccess || false;

    return (
        <BaseNode {...props}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <SmartToyIcon fontSize="small" />
                {testSuccess && (
                    <CheckCircleIcon
                        fontSize="small"
                        color="success"
                        sx={{ ml: 0.5, fontSize: '16px' }}
                    />
                )}
            </Box>
        </BaseNode>
    );
}

export default React.memo(LlmNode); 