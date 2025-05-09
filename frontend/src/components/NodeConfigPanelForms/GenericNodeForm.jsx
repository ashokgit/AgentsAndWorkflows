import React from 'react';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';

// Assuming NodeInputSelector is passed as prop

const GenericNodeForm = ({
    node, // For NodeInputSelector and node.type display
    formData,
    nodes,
    edges, // For NodeInputSelector
    commonTextFieldProps, // For the read-only TextField
    NodeInputSelector,
}) => {
    return (
        <>
            <NodeInputSelector node={node} nodes={nodes} edges={edges} />

            <Typography variant="body2" color="textSecondary">No specific configuration available for node type: {node.type}</Typography>
            <TextField
                label="Data (JSON - Read Only)"
                multiline
                rows={8}
                value={JSON.stringify(formData, null, 2)}
                InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', backgroundColor: '#f5f5f5' } }}
                {...commonTextFieldProps} // Spread common props, though many won't apply to readOnly
            />
        </>
    );
};

export default GenericNodeForm; 