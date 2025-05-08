import React from 'react';
import BaseNode from './BaseNode';
import SettingsIcon from '@mui/icons-material/Settings'; // Model config icon
import CheckCircleIcon from '@mui/icons-material/CheckCircle'; // Success icon
import Box from '@mui/material/Box';

function ModelConfigNode(props) {
    const { data } = props;
    const modelName = data?.model || '';
    const testSuccess = data?.testSuccess || false;

    return (
        <BaseNode {...props}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <SettingsIcon fontSize="small" />
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

export default React.memo(ModelConfigNode); 