import React from 'react';
import BaseNode from './BaseNode';
import CodeIcon from '@mui/icons-material/Code';

function CodeNode(props) {
    return (
        <BaseNode {...props}>
            <CodeIcon fontSize="small" />
        </BaseNode>
    );
}

export default React.memo(CodeNode); 