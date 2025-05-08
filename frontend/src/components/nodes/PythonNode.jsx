import React from 'react';
import BaseNode from './BaseNode';
import CodeIcon from '@mui/icons-material/Code';

function PythonNode(props) {
    return (
        <BaseNode {...props}>
            <CodeIcon fontSize="small" />
        </BaseNode>
    );
}

export default React.memo(PythonNode); 