import React from 'react';
import BaseNode from './BaseNode';
import SettingsIcon from '@mui/icons-material/Settings'; // Model config icon
import CheckCircleIcon from '@mui/icons-material/CheckCircle'; // Success icon
import Box from '@mui/material/Box';

function ModelConfigNode(props) {
    const { data } = props;
    const modelName = data?.model || '';
    const configName = data?.config_name || '';
    const testSuccess = data?.testSuccess || false;

    // Create a label that includes the model name if available
    const displayLabel = configName ? configName : (modelName ? `Model Configuration (${modelName})` : 'Model Configuration');

    // Update the props with the new label
    const updatedProps = {
        ...props,
        data: {
            ...props.data,
            label: displayLabel
        }
    };

    return (
        <BaseNode {...updatedProps}>
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