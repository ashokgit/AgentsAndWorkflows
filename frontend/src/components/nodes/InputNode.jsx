import React from 'react';
import BaseNode from './BaseNode';
import InputIcon from '@mui/icons-material/Input';

function InputNode(props) {
    // Input node might have different handle configurations (e.g., no input handles)
    // For now, we use BaseNode which has all 4, but this could be customized.
    return (
        <BaseNode {...props}>
            <InputIcon fontSize="small" />
        </BaseNode>
    );
}

export default React.memo(InputNode); 