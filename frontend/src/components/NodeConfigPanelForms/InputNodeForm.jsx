import React from 'react';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// Assuming NodeInputSelector is passed as prop

const InputNodeForm = ({
    node, // For NodeInputSelector and determining label
    formData,
    nodes,
    edges, // For NodeInputSelector
    commonTextFieldProps,
    NodeInputSelector,
}) => {
    return (
        <>
            <NodeInputSelector node={node} nodes={nodes} edges={edges} />

            <TextField
                label="Name"
                name="node_name" // Assuming node_name is the target, or label
                value={formData.node_name || formData.label || node.type || ''}
                placeholder="Give this node a descriptive name"
                {...commonTextFieldProps}
            />
            <Typography variant="caption" color="textSecondary">Node name for identification in the workflow.</Typography>
        </>
    );
};

export default InputNodeForm; 