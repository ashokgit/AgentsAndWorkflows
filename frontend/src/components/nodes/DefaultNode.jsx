import React from 'react';
import BaseNode from './BaseNode';
import NotesIcon from '@mui/icons-material/Notes';

function DefaultNode(props) {
    return (
        <BaseNode {...props}>
            <NotesIcon fontSize="small" />
        </BaseNode>
    );
}

export default React.memo(DefaultNode); 