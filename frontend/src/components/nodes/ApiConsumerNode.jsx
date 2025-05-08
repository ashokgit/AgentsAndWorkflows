import React from 'react';
import BaseNode from './BaseNode';
import ApiIcon from '@mui/icons-material/Api'; // API icon
import CheckCircleIcon from '@mui/icons-material/CheckCircle'; // Success icon
import Box from '@mui/material/Box';

function ApiConsumerNode(props) {
    const { data } = props;
    const testSuccess = data?.testSuccess || false;

    return (
        <BaseNode {...props}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <ApiIcon fontSize="small" />
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

export default React.memo(ApiConsumerNode); 