import React from 'react';
import BaseNode from './BaseNode';
import SmartToyIcon from '@mui/icons-material/SmartToy'; // LLM Icon

function LlmNode(props) {
    return (
        <BaseNode {...props}>
            <SmartToyIcon fontSize="small" />
        </BaseNode>
    );
}

export default React.memo(LlmNode); 